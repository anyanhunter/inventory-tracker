import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

const adapter = new PrismaPg({
	connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "development-secret-change-before-deployment";

app.use(express.json());
app.use(express.static("public"));

// --------------------
// Helpers
// --------------------

function createToken(userId) {
	return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function createInviteCode() {
	return crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function authenticate(req, res, next) {
	try {
		const header = req.headers.authorization;

		if (!header?.startsWith("Bearer ")) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const token = header.substring(7);
		const decoded = jwt.verify(token, JWT_SECRET);

		const user = await prisma.user.findUnique({
			where: { id: decoded.userId },
			include: {
				memberships: {
					include: {
						organization: true,
					},
				},
			},
		});

		if (!user) {
			return res.status(401).json({ error: "User not found" });
		}

		req.user = user;
		next();
	} catch (error) {
		return res.status(401).json({ error: "Invalid or expired login" });
	}
}

// --------------------
// Health check
// --------------------

app.get("/", (req, res) => {
	res.send("Inventory Tracker is running!");
});

// --------------------
// Register
// --------------------

app.post("/api/register", async (req, res) => {
	try {
		const { email, password, firstName, lastName } = req.body;

		if (!email || !password || !firstName || !lastName) {
			return res.status(400).json({
				error: "Email, password, first name, and last name are required",
			});
		}

		if (password.length < 8) {
			return res.status(400).json({
				error: "Password must be at least 8 characters",
			});
		}

		const normalizedEmail = email.trim().toLowerCase();

		const existingUser = await prisma.user.findUnique({
			where: { email: normalizedEmail },
		});

		if (existingUser) {
			return res.status(409).json({
				error: "An account with that email already exists",
			});
		}

		const passwordHash = await bcrypt.hash(password, 12);

		const user = await prisma.user.create({
			data: {
				email: normalizedEmail,
				passwordHash,
				firstName: firstName.trim(),
				lastName: lastName.trim(),
			},
		});

		const token = createToken(user.id);

		res.status(201).json({
			message: "Account created",
			token,
			user: {
				id: user.id,
				email: user.email,
				firstName: user.firstName,
				lastName: user.lastName,
			},
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to create account" });
	}
});

// --------------------
// Login
// --------------------

app.post("/api/login", async (req, res) => {
	try {
		const { email, password } = req.body;

		if (!email || !password) {
			return res.status(400).json({
				error: "Email and password are required",
			});
		}

		const user = await prisma.user.findUnique({
			where: {
				email: email.trim().toLowerCase(),
			},
			include: {
				memberships: {
					include: {
						organization: true,
					},
				},
			},
		});

		if (!user) {
			return res.status(401).json({
				error: "Invalid email or password",
			});
		}

		const passwordMatches = await bcrypt.compare(
			password,
			user.passwordHash
		);

		if (!passwordMatches) {
			return res.status(401).json({
				error: "Invalid email or password",
			});
		}

		const token = createToken(user.id);

		res.json({
			message: "Login successful",
			token,
			user: {
				id: user.id,
				email: user.email,
				firstName: user.firstName,
				lastName: user.lastName,
				memberships: user.memberships.map((membership) => ({
					role: membership.role,
					organization: membership.organization,
				})),
			},
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to log in" });
	}
});

// --------------------
// Create organization
// Creator automatically becomes ADMIN
// --------------------

app.post("/api/organizations", authenticate, async (req, res) => {
	try {
		const { name } = req.body;

		if (!name?.trim()) {
			return res.status(400).json({
				error: "Organization name is required",
			});
		}

		const inviteCode = createInviteCode();

		const organization = await prisma.organization.create({
			data: {
				name: name.trim(),
				memberships: {
					create: {
						userId: req.user.id,
						role: "ADMIN",
					},
				},
				inviteCodes: {
					create: {
						code: inviteCode,
					},
				},
			},
			include: {
				inviteCodes: true,
			},
		});

		res.status(201).json({
			message: "Organization created",
			organization,
			inviteCode,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({
			error: "Unable to create organization",
		});
	}
});

// --------------------
// Join organization
// --------------------

app.post("/api/organizations/join", authenticate, async (req, res) => {
	try {
		const { code } = req.body;

		if (!code?.trim()) {
			return res.status(400).json({
				error: "Company code is required",
			});
		}

		const invite = await prisma.inviteCode.findUnique({
			where: {
				code: code.trim().toUpperCase(),
			},
			include: {
				organization: true,
			},
		});

		if (!invite || !invite.active) {
			return res.status(404).json({
				error: "Invalid or inactive company code",
			});
		}

		if (invite.expiresAt && invite.expiresAt < new Date()) {
			return res.status(410).json({
				error: "This company code has expired",
			});
		}

		const existingMembership = await prisma.membership.findUnique({
			where: {
				userId_organizationId: {
					userId: req.user.id,
					organizationId: invite.organizationId,
				},
			},
		});

		if (existingMembership) {
			return res.status(409).json({
				error: "You already belong to this organization",
			});
		}

		const membership = await prisma.membership.create({
			data: {
				userId: req.user.id,
				organizationId: invite.organizationId,
				role: "MEMBER",
			},
		});

		res.status(201).json({
			message: "Organization joined",
			organization: invite.organization,
			role: membership.role,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({
			error: "Unable to join organization",
		});
	}
});

// --------------------
// Current account
// --------------------

app.get("/api/me", authenticate, async (req, res) => {
	res.json({
		id: req.user.id,
		email: req.user.email,
		firstName: req.user.firstName,
		lastName: req.user.lastName,
		memberships: req.user.memberships.map((membership) => ({
			role: membership.role,
			organization: membership.organization,
		})),
	});
});

app.listen(PORT, () => {
	console.log(`Inventory Tracker server is running on port ${PORT}`);
});
// --------------------
// Organization helper
// --------------------

async function getMembership(userId, organizationId) {
	return prisma.membership.findUnique({
		where: {
			userId_organizationId: {
				userId,
				organizationId,
			},
		},
	});
}

// --------------------
// Locations
// --------------------

// Get all locations for an organization
app.get("/api/organizations/:organizationId/locations", authenticate, async (req, res) => {
	try {
		const { organizationId } = req.params;

		const membership = await getMembership(req.user.id, organizationId);

		if (!membership) {
			return res.status(403).json({ error: "Access denied" });
		}

		const locations = await prisma.location.findMany({
			where: { organizationId },
			orderBy: { name: "asc" },
		});

		res.json(locations);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to load locations" });
	}
});

// Create a location
app.post("/api/organizations/:organizationId/locations", authenticate, async (req, res) => {
	try {
		const { organizationId } = req.params;
		const { name, parentId } = req.body;

		const membership = await getMembership(req.user.id, organizationId);

		if (!membership) {
			return res.status(403).json({ error: "Access denied" });
		}

		if (!name?.trim()) {
			return res.status(400).json({ error: "Location name is required" });
		}

		if (parentId) {
			const parent = await prisma.location.findFirst({
				where: {
					id: parentId,
					organizationId,
				},
			});

			if (!parent) {
				return res.status(400).json({ error: "Invalid parent location" });
			}
		}

		const location = await prisma.location.create({
			data: {
				name: name.trim(),
				organizationId,
				parentId: parentId || null,
			},
		});

		res.status(201).json(location);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to create location" });
	}
});
// Delete a location
app.delete(
	"/api/organizations/:organizationId/locations/:locationId",
	authenticate,
	async (req, res) => {
		try {
			const { organizationId, locationId } = req.params;

			const membership = await getMembership(
				req.user.id,
				organizationId
			);

			if (!membership) {
				return res.status(403).json({ error: "Access denied" });
			}

			const location = await prisma.location.findFirst({
				where: {
					id: locationId,
					organizationId
				},
				include: {
	children: true,
	inventoryItems: true
}
			});

			if (!location) {
				return res.status(404).json({
					error: "Location not found"
				});
			}

			if (location.children.length > 0) {
				return res.status(400).json({
					error: "Delete the locations inside this location first."
				});
			}

			if (location.inventoryItems.length > 0) {
				return res.status(400).json({
					error: "Move or remove the inventory in this location first."
				});
			}

			await prisma.location.delete({
				where: { id: locationId }
			});

			res.json({ message: "Location deleted" });
		} catch (error) {
			console.error(error);
			res.status(500).json({
				error: "Unable to delete location"
			});
		}
	}
);
// --------------------
// Categories
// --------------------

// Get all categories for an organization
app.get("/api/organizations/:organizationId/categories", authenticate, async (req, res) => {
	try {
		const { organizationId } = req.params;

		const membership = await getMembership(req.user.id, organizationId);

		if (!membership) {
			return res.status(403).json({ error: "Access denied" });
		}

		const categories = await prisma.category.findMany({
			where: { organizationId },
			orderBy: { name: "asc" }
		});

		res.json(categories);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to load categories" });
	}
});

// Create a category
app.post("/api/organizations/:organizationId/categories", authenticate, async (req, res) => {
	try {
		const { organizationId } = req.params;
		const { name, parentId } = req.body;

		const membership = await getMembership(req.user.id, organizationId);

		if (!membership) {
			return res.status(403).json({ error: "Access denied" });
		}

		if (!name?.trim()) {
			return res.status(400).json({ error: "Category name is required" });
		}

		if (parentId) {
			const parent = await prisma.category.findFirst({
				where: {
					id: parentId,
					organizationId
				}
			});

			if (!parent) {
				return res.status(400).json({ error: "Invalid parent category" });
			}
		}

		const category = await prisma.category.create({
			data: {
				name: name.trim(),
				organizationId,
				parentId: parentId || null
			}
		});

		res.status(201).json(category);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to create category" });
	}
});
// Delete a category
app.delete(
	"/api/organizations/:organizationId/categories/:categoryId",
	authenticate,
	async (req, res) => {
		try {
			const { organizationId, categoryId } = req.params;

			const membership = await getMembership(req.user.id, organizationId);

			if (!membership) {
				return res.status(403).json({ error: "Access denied" });
			}

			const category = await prisma.category.findFirst({
				where: {
					id: categoryId,
					organizationId
				},
				include: {
					children: true,
					inventoryItems: true
				}
			});

			if (!category) {
				return res.status(404).json({ error: "Category not found" });
			}

			if (category.children.length > 0) {
				return res.status(400).json({
					error: "Delete the subcategories inside this category first."
				});
			}

			if (category.inventoryItems.length > 0) {
				return res.status(400).json({
					error: "Move or remove the inventory in this category first."
				});
			}

			await prisma.category.delete({
				where: { id: categoryId }
			});

			res.json({ message: "Category deleted" });
		} catch (error) {
			console.error(error);
			res.status(500).json({ error: "Unable to delete category" });
		}
	}
);
// --------------------
// Inventory
// --------------------

// Get inventory
app.get("/api/organizations/:organizationId/inventory", authenticate, async (req, res) => {
	try {
		const { organizationId } = req.params;
		const { search, sort = "asc" } = req.query;

		const membership = await getMembership(req.user.id, organizationId);

		if (!membership) {
			return res.status(403).json({ error: "Access denied" });
		}

		const items = await prisma.inventoryItem.findMany({
			where: {
				organizationId,
				...(search
					? {
							name: {
								contains: search,
								mode: "insensitive",
							},
						}
					: {}),
			},
			include: {
				location: true,
			},
			orderBy: {
				name: sort === "desc" ? "desc" : "asc",
			},
		});

		res.json(items);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to load inventory" });
	}
});

// Add inventory item
app.post("/api/organizations/:organizationId/inventory", authenticate, async (req, res) => {
	try {
		const { organizationId } = req.params;
		const { name, quantity, notes, locationId } = req.body;

		const membership = await getMembership(req.user.id, organizationId);

		if (!membership) {
			return res.status(403).json({ error: "Access denied" });
		}

		if (!name?.trim()) {
			return res.status(400).json({ error: "Item name is required" });
		}

		const parsedQuantity = Number(quantity ?? 0);

		if (!Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
			return res.status(400).json({
				error: "Quantity must be a whole number of zero or greater",
			});
		}

		if (locationId) {
			const location = await prisma.location.findFirst({
				where: {
					id: locationId,
					organizationId,
				},
			});

			if (!location) {
				return res.status(400).json({ error: "Invalid location" });
			}
		}

		const item = await prisma.inventoryItem.create({
			data: {
				name: name.trim(),
				quantity: parsedQuantity,
				notes: notes?.trim() || null,
				organizationId,
				locationId: locationId || null,
			},
			include: {
				location: true,
			},
		});

		res.status(201).json(item);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to create inventory item" });
	}
});

// Edit inventory item
app.put("/api/organizations/:organizationId/inventory/:itemId", authenticate, async (req, res) => {
	try {
		const { organizationId, itemId } = req.params;
		const { name, quantity, notes, locationId } = req.body;

		const membership = await getMembership(req.user.id, organizationId);

		if (!membership) {
			return res.status(403).json({ error: "Access denied" });
		}

		const existingItem = await prisma.inventoryItem.findFirst({
			where: {
				id: itemId,
				organizationId,
			},
		});

		if (!existingItem) {
			return res.status(404).json({ error: "Inventory item not found" });
		}

		const parsedQuantity =
			quantity === undefined ? existingItem.quantity : Number(quantity);

		if (!Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
			return res.status(400).json({
				error: "Quantity must be a whole number of zero or greater",
			});
		}

		if (locationId) {
			const location = await prisma.location.findFirst({
				where: {
					id: locationId,
					organizationId,
				},
			});

			if (!location) {
				return res.status(400).json({ error: "Invalid location" });
			}
		}

		const item = await prisma.inventoryItem.update({
			where: { id: itemId },
			data: {
				name: name?.trim() || existingItem.name,
				quantity: parsedQuantity,
				notes: notes !== undefined ? notes?.trim() || null : existingItem.notes,
				locationId:
					locationId !== undefined ? locationId || null : existingItem.locationId,
			},
			include: {
				location: true,
			},
		});

		res.json(item);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to update inventory item" });
	}
});

// Delete inventory item
app.delete("/api/organizations/:organizationId/inventory/:itemId", authenticate, async (req, res) => {
	try {
		const { organizationId, itemId } = req.params;

		const membership = await getMembership(req.user.id, organizationId);

		if (!membership) {
			return res.status(403).json({ error: "Access denied" });
		}

		const existingItem = await prisma.inventoryItem.findFirst({
			where: {
				id: itemId,
				organizationId,
			},
		});

		if (!existingItem) {
			return res.status(404).json({ error: "Inventory item not found" });
		}

		await prisma.inventoryItem.delete({
			where: { id: itemId },
		});

		res.json({ message: "Inventory item deleted" });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Unable to delete inventory item" });
	}
});