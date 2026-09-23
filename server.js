import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "./generated/prisma/client.ts";

const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL
});

const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET =
	process.env.JWT_SECRET || "development-secret-change-before-deployment";

app.use(express.json());
app.use(express.static("public"));


// ============================================================
// HELPERS
// ============================================================

function createToken(userId) {
	return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function createInviteCode() {
	return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function cleanItem(item) {
	if (!item) return null;

	return {
		id: item.id,
		name: item.name,
		quantity: item.quantity,
		notes: item.notes,
		organizationId: item.organizationId,
		locationId: item.locationId,
		categoryId: item.categoryId
	};
}

async function authenticate(req, res, next) {
	try {
		const header = req.headers.authorization;

		if (!header?.startsWith("Bearer ")) {
			return res.status(401).json({
				error: "Authentication required"
			});
		}

		const token = header.substring(7);
		const decoded = jwt.verify(token, JWT_SECRET);

		const user = await prisma.user.findUnique({
			where: {
				id: decoded.userId
			},
			include: {
				memberships: {
					include: {
						organization: true
					}
				}
			}
		});

		if (!user) {
			return res.status(401).json({
				error: "User not found"
			});
		}

		req.user = user;
		next();
	} catch (error) {
		return res.status(401).json({
			error: "Invalid or expired login"
		});
	}
}

async function getMembership(userId, organizationId) {
	return prisma.membership.findUnique({
		where: {
			userId_organizationId: {
				userId,
				organizationId
			}
		}
	});
}

async function requireMembership(req, res) {
	const membership = await getMembership(
		req.user.id,
		req.params.organizationId
	);

	if (!membership) {
		res.status(403).json({
			error: "Access denied"
		});

		return null;
	}

	return membership;
}

async function requireAdmin(req, res) {
	const membership = await requireMembership(req, res);

	if (!membership) return null;

	if (membership.role !== "ADMIN") {
		res.status(403).json({
			error: "Administrator access required"
		});

		return null;
	}

	return membership;
}

async function writeAudit({
	userId,
	organizationId,
	action,
	entityType,
	entityId,
	beforeData = null,
	afterData = null
}) {
	return prisma.auditLog.create({
		data: {
			userId,
			organizationId,
			action,
			entityType,
			entityId,
			beforeData,
			afterData
		}
	});
}


// ============================================================
// AUTHENTICATION
// ============================================================

app.post("/api/register", async (req, res) => {
	try {
		const {
			email,
			password,
			firstName,
			lastName
		} = req.body;

		if (!email || !password || !firstName || !lastName) {
			return res.status(400).json({
				error:
					"Email, password, first name, and last name are required"
			});
		}

		if (password.length < 8) {
			return res.status(400).json({
				error: "Password must be at least 8 characters"
			});
		}

		const normalizedEmail = email.trim().toLowerCase();

		const existingUser = await prisma.user.findUnique({
			where: {
				email: normalizedEmail
			}
		});

		if (existingUser) {
			return res.status(409).json({
				error: "An account with that email already exists"
			});
		}

		const passwordHash = await bcrypt.hash(password, 12);

		const user = await prisma.user.create({
			data: {
				email: normalizedEmail,
				passwordHash,
				firstName: firstName.trim(),
				lastName: lastName.trim()
			}
		});

		const token = createToken(user.id);

		res.status(201).json({
			message: "Account created",
			token,
			user: {
				id: user.id,
				email: user.email,
				firstName: user.firstName,
				lastName: user.lastName
			}
		});
	} catch (error) {
		console.error(error);

		res.status(500).json({
			error: "Unable to create account"
		});
	}
});


app.post("/api/login", async (req, res) => {
	try {
		const { email, password } = req.body;

		if (!email || !password) {
			return res.status(400).json({
				error: "Email and password are required"
			});
		}

		const user = await prisma.user.findUnique({
			where: {
				email: email.trim().toLowerCase()
			},
			include: {
				memberships: {
					include: {
						organization: true
					}
				}
			}
		});

		if (!user) {
			return res.status(401).json({
				error: "Invalid email or password"
			});
		}

		const passwordMatches = await bcrypt.compare(
			password,
			user.passwordHash
		);

		if (!passwordMatches) {
			return res.status(401).json({
				error: "Invalid email or password"
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
				memberships: user.memberships.map(
					(membership) => ({
						role: membership.role,
						organization:
							membership.organization
					})
				)
			}
		});
	} catch (error) {
		console.error(error);

		res.status(500).json({
			error: "Unable to log in"
		});
	}
});


app.get("/api/me", authenticate, async (req, res) => {
	res.json({
		id: req.user.id,
		email: req.user.email,
		firstName: req.user.firstName,
		lastName: req.user.lastName,
		memberships: req.user.memberships.map(
			(membership) => ({
				role: membership.role,
				organization: membership.organization
			})
		)
	});
});


// ============================================================
// ORGANIZATIONS
// ============================================================

app.post("/api/organizations", authenticate, async (req, res) => {
	try {
		const { name } = req.body;

		if (!name?.trim()) {
			return res.status(400).json({
				error: "Organization name is required"
			});
		}

		const inviteCode = createInviteCode();

		const organization =
			await prisma.organization.create({
				data: {
					name: name.trim(),

					memberships: {
						create: {
							userId: req.user.id,
							role: "ADMIN"
						}
					},

					inviteCodes: {
						create: {
							code: inviteCode
						}
					}
				}
			});

		res.status(201).json({
			message: "Organization created",
			organization,
			inviteCode
		});
	} catch (error) {
		console.error(error);

		res.status(500).json({
			error: "Unable to create organization"
		});
	}
});


app.post(
	"/api/organizations/join",
	authenticate,
	async (req, res) => {
		try {
			const { code } = req.body;

			if (!code?.trim()) {
				return res.status(400).json({
					error: "Company code is required"
				});
			}

			const invite =
				await prisma.inviteCode.findUnique({
					where: {
						code: code
							.trim()
							.toUpperCase()
					},
					include: {
						organization: true
					}
				});

			if (!invite || !invite.active) {
				return res.status(404).json({
					error:
						"Invalid or inactive company code"
				});
			}

			if (
				invite.expiresAt &&
				invite.expiresAt < new Date()
			) {
				return res.status(410).json({
					error:
						"This company code has expired"
				});
			}

			const existingMembership =
				await getMembership(
					req.user.id,
					invite.organizationId
				);

			if (existingMembership) {
				return res.status(409).json({
					error:
						"You already belong to this organization"
				});
			}

			const membership =
				await prisma.membership.create({
					data: {
						userId: req.user.id,
						organizationId:
							invite.organizationId,
						role: "MEMBER"
					}
				});

			res.status(201).json({
				message: "Organization joined",
				organization: invite.organization,
				role: membership.role
			});
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error:
					"Unable to join organization"
			});
		}
	}
);


// ============================================================
// ADMIN — MEMBERS
// ============================================================

app.get(
	"/api/organizations/:organizationId/members",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			const memberships =
				await prisma.membership.findMany({
					where: {
						organizationId:
							req.params.organizationId
					},
					include: {
						user: true
					},
					orderBy: {
						createdAt: "asc"
					}
				});

			res.json(
				memberships.map((membership) => ({
					id: membership.id,
					role: membership.role,
					joinedAt:
						membership.createdAt,
					user: {
						id: membership.user.id,
						firstName:
							membership.user.firstName,
						lastName:
							membership.user.lastName,
						email:
							membership.user.email
					}
				}))
			);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to load members"
			});
		}
	}
);


app.put(
	"/api/organizations/:organizationId/members/:membershipId",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			const { role } = req.body;

			if (!["ADMIN", "MEMBER"].includes(role)) {
				return res.status(400).json({
					error: "Invalid role"
				});
			}

			const membership =
				await prisma.membership.findFirst({
					where: {
						id: req.params.membershipId,
						organizationId:
							req.params.organizationId
					}
				});

			if (!membership) {
				return res.status(404).json({
					error: "Member not found"
				});
			}

			if (
				membership.userId === req.user.id &&
				role !== "ADMIN"
			) {
				return res.status(400).json({
					error:
						"You cannot remove your own administrator access"
				});
			}

			const updated =
				await prisma.membership.update({
					where: {
						id: membership.id
					},
					data: {
						role
					}
				});

			res.json(updated);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to update member"
			});
		}
	}
);


app.delete(
	"/api/organizations/:organizationId/members/:membershipId",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			const membership =
				await prisma.membership.findFirst({
					where: {
						id: req.params.membershipId,
						organizationId:
							req.params.organizationId
					}
				});

			if (!membership) {
				return res.status(404).json({
					error: "Member not found"
				});
			}

			if (membership.userId === req.user.id) {
				return res.status(400).json({
					error:
						"You cannot remove yourself from the organization"
				});
			}

			await prisma.membership.delete({
				where: {
					id: membership.id
				}
			});

			res.json({
				message: "Member removed"
			});
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to remove member"
			});
		}
	}
);


// ============================================================
// ADMIN — INVITE CODES
// ============================================================

app.get(
	"/api/organizations/:organizationId/invites",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			const invites =
				await prisma.inviteCode.findMany({
					where: {
						organizationId:
							req.params.organizationId
					},
					orderBy: {
						createdAt: "desc"
					}
				});

			res.json(invites);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error:
					"Unable to load company codes"
			});
		}
	}
);


app.post(
	"/api/organizations/:organizationId/invites",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			await prisma.inviteCode.updateMany({
				where: {
					organizationId:
						req.params.organizationId,
					active: true
				},
				data: {
					active: false
				}
			});

			const invite =
				await prisma.inviteCode.create({
					data: {
						code: createInviteCode(),
						organizationId:
							req.params.organizationId
					}
				});

			res.status(201).json(invite);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error:
					"Unable to create company code"
			});
		}
	}
);


app.put(
	"/api/organizations/:organizationId/invites/:inviteId/disable",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			const invite =
				await prisma.inviteCode.findFirst({
					where: {
						id: req.params.inviteId,
						organizationId:
							req.params.organizationId
					}
				});

			if (!invite) {
				return res.status(404).json({
					error: "Company code not found"
				});
			}

			const updated =
				await prisma.inviteCode.update({
					where: {
						id: invite.id
					},
					data: {
						active: false
					}
				});

			res.json(updated);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error:
					"Unable to disable company code"
			});
		}
	}
);


// ============================================================
// LOCATIONS
// ============================================================

app.get(
	"/api/organizations/:organizationId/locations",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const locations =
				await prisma.location.findMany({
					where: {
						organizationId:
							req.params.organizationId
					},
					orderBy: {
						name: "asc"
					}
				});

			res.json(locations);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to load locations"
			});
		}
	}
);


app.post(
	"/api/organizations/:organizationId/locations",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const { name, parentId } = req.body;
			const { organizationId } = req.params;

			if (!name?.trim()) {
				return res.status(400).json({
					error: "Location name is required"
				});
			}

			if (parentId) {
				const parent =
					await prisma.location.findFirst({
						where: {
							id: parentId,
							organizationId
						}
					});

				if (!parent) {
					return res.status(400).json({
						error:
							"Invalid parent location"
					});
				}
			}

			const location =
				await prisma.location.create({
					data: {
						name: name.trim(),
						parentId: parentId || null,
						organizationId
					}
				});

			await writeAudit({
				userId: req.user.id,
				organizationId,
				action: "CREATE",
				entityType: "LOCATION",
				entityId: location.id,
				afterData: location
			});

			res.status(201).json(location);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to create location"
			});
		}
	}
);


app.delete(
	"/api/organizations/:organizationId/locations/:locationId",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const { organizationId, locationId } =
				req.params;

			const rootLocation =
				await prisma.location.findFirst({
					where: {
						id: locationId,
						organizationId
					}
				});

			if (!rootLocation) {
				return res.status(404).json({
					error: "Location not found"
				});
			}

			/*
				Find the selected location and every
				location nested inside it.
			*/

			const allLocations =
				await prisma.location.findMany({
					where: {
						organizationId
					}
				});

			const locationIds = [];
			const locationsToDelete = [];

			function collectLocations(parentId) {
				const matches =
					allLocations.filter(
						(location) =>
							location.id === parentId ||
							location.parentId === parentId
					);

				for (const location of matches) {
					if (
						locationIds.includes(location.id)
					) {
						continue;
					}

					locationIds.push(location.id);
					locationsToDelete.push(location);

					collectLocations(location.id);
				}
			}

			collectLocations(rootLocation.id);

			/*
				Collect inventory stored anywhere inside
				the location tree before anything is deleted.
			*/

			const inventoryToDelete =
				await prisma.inventoryItem.findMany({
					where: {
						organizationId,
						locationId: {
							in: locationIds
						}
					}
				});

			await prisma.$transaction(async (tx) => {
				/*
					Delete inventory first and preserve a
					full snapshot in the audit history so
					admin recovery can recreate it.
				*/

				for (const item of inventoryToDelete) {
					const beforeData = cleanItem(item);

					await tx.inventoryItem.delete({
						where: {
							id: item.id
						}
					});

					await tx.auditLog.create({
						data: {
							userId: req.user.id,
							organizationId,
							action: "DELETE",
							entityType:
								"INVENTORY_ITEM",
							entityId: item.id,
							beforeData
						}
					});
				}

				/*
					Delete locations deepest-first so a
					parent is never removed before the
					locations inside it.
				*/

				const orderedLocations =
					[...locationsToDelete].sort(
						(a, b) => {
							function depth(location) {
								let count = 0;
								let current = location;

								while (current?.parentId) {
									count++;

									current =
										allLocations.find(
											(entry) =>
												entry.id ===
												current.parentId
										);
								}

								return count;
							}

							return depth(b) - depth(a);
						}
					);

				for (const location of orderedLocations) {
					const beforeData = {
						id: location.id,
						name: location.name,
						parentId: location.parentId,
						organizationId:
							location.organizationId
					};

					await tx.location.delete({
						where: {
							id: location.id
						}
					});

					await tx.auditLog.create({
						data: {
							userId: req.user.id,
							organizationId,
							action: "DELETE",
							entityType: "LOCATION",
							entityId: location.id,
							beforeData
						}
					});
				}
			});

			res.json({
				message: "Location deleted",
				deletedLocations:
					locationsToDelete.length,
				deletedInventory:
					inventoryToDelete.length
			});
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to delete location"
			});
		}
	}
);


// ============================================================
// CATEGORIES
// ============================================================

app.get(
	"/api/organizations/:organizationId/categories",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const categories =
				await prisma.category.findMany({
					where: {
						organizationId:
							req.params.organizationId
					},
					orderBy: {
						name: "asc"
					}
				});

			res.json(categories);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to load categories"
			});
		}
	}
);


app.post(
	"/api/organizations/:organizationId/categories",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const { name, parentId } = req.body;
			const { organizationId } = req.params;

			if (!name?.trim()) {
				return res.status(400).json({
					error: "Category name is required"
				});
			}

			if (parentId) {
				const parent =
					await prisma.category.findFirst({
						where: {
							id: parentId,
							organizationId
						}
					});

				if (!parent) {
					return res.status(400).json({
						error:
							"Invalid parent category"
					});
				}
			}

			const category =
				await prisma.category.create({
					data: {
						name: name.trim(),
						parentId: parentId || null,
						organizationId
					}
				});

			await writeAudit({
				userId: req.user.id,
				organizationId,
				action: "CREATE",
				entityType: "CATEGORY",
				entityId: category.id,
				afterData: category
			});

			res.status(201).json(category);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to create category"
			});
		}
	}
);


app.delete(
	"/api/organizations/:organizationId/categories/:categoryId",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const { organizationId, categoryId } = req.params;

			const rootCategory =
				await prisma.category.findFirst({
					where: {
						id: categoryId,
						organizationId
					}
				});

			if (!rootCategory) {
				return res.status(404).json({
					error: "Category not found"
				});
			}

			const allCategories =
				await prisma.category.findMany({
					where: {
						organizationId
					}
				});

			const categoryIds = [];
			const categoryDepths = new Map();

			function collectCategoryIds(parentId, depth = 0) {
				const children = allCategories.filter(
					(category) =>
						category.parentId === parentId
				);

				for (const child of children) {
					categoryIds.push(child.id);
					categoryDepths.set(child.id, depth);

					collectCategoryIds(
						child.id,
						depth + 1
					);
				}
			}

			categoryIds.push(rootCategory.id);
			categoryDepths.set(rootCategory.id, 0);

			collectCategoryIds(rootCategory.id, 1);

			const categoriesToDelete =
				allCategories
					.filter((category) =>
						categoryIds.includes(category.id)
					)
					.sort(
						(a, b) =>
							(categoryDepths.get(b.id) || 0) -
							(categoryDepths.get(a.id) || 0)
					);

			const inventoryToDelete =
				await prisma.inventoryItem.findMany({
					where: {
						organizationId,
						categoryId: {
							in: categoryIds
						}
					}
				});

			await prisma.$transaction(async (tx) => {

				// Delete and audit inventory first.
				for (const item of inventoryToDelete) {
					await tx.inventoryItem.delete({
						where: {
							id: item.id
						}
					});

					await writeAudit({
						userId: req.user.id,
						organizationId,
						action: "DELETE",
						entityType: "INVENTORY_ITEM",
						entityId: item.id,
						beforeData: cleanItem(item)
					});
				}

				// Delete deepest categories first.
				for (const category of categoriesToDelete) {
					await tx.category.delete({
						where: {
							id: category.id
						}
					});

					await writeAudit({
						userId: req.user.id,
						organizationId,
						action: "DELETE",
						entityType: "CATEGORY",
						entityId: category.id,
						beforeData: {
							id: category.id,
							name: category.name,
							parentId: category.parentId,
							organizationId:
								category.organizationId
						}
					});
				}
			});

			res.json({
				message: "Category deleted",
				deletedCategories:
					categoriesToDelete.length,
				deletedInventory:
					inventoryToDelete.length
			});
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to delete category"
			});
		}
	}
);


// ============================================================
// INVENTORY
// ============================================================

app.get(
	"/api/organizations/:organizationId/inventory",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const { organizationId } = req.params;
			const { search, sort = "asc" } = req.query;

			const items =
				await prisma.inventoryItem.findMany({
					where: {
						organizationId,

						...(search
							? {
									OR: [
										{
											name: {
												contains:
													search,
												mode:
													"insensitive"
											}
										},
										{
											notes: {
												contains:
													search,
												mode:
													"insensitive"
											}
										},
										{
											location: {
												name: {
													contains:
														search,
													mode:
														"insensitive"
												}
											}
										},
										{
											category: {
												name: {
													contains:
														search,
													mode:
														"insensitive"
												}
											}
										}
									]
								}
							: {})
					},

					include: {
						location: true,
						category: true
					},

					orderBy: {
						name:
							sort === "desc"
								? "desc"
								: "asc"
					}
				});

			res.json(items);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to load inventory"
			});
		}
	}
);


app.post(
	"/api/organizations/:organizationId/inventory",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const { organizationId } = req.params;

			const {
				name,
				quantity,
				notes,
				locationId,
				categoryId
			} = req.body;

			if (!name?.trim()) {
				return res.status(400).json({
					error: "Item name is required"
				});
			}

			const parsedQuantity = Number(
				quantity ?? 0
			);

			if (
				!Number.isInteger(parsedQuantity) ||
				parsedQuantity < 0
			) {
				return res.status(400).json({
					error:
						"Quantity must be a whole number of zero or greater"
				});
			}

			if (locationId) {
				const location =
					await prisma.location.findFirst({
						where: {
							id: locationId,
							organizationId
						}
					});

				if (!location) {
					return res.status(400).json({
						error: "Invalid location"
					});
				}
			}

			if (categoryId) {
				const category =
					await prisma.category.findFirst({
						where: {
							id: categoryId,
							organizationId
						}
					});

				if (!category) {
					return res.status(400).json({
						error: "Invalid category"
					});
				}
			}

			const item =
				await prisma.inventoryItem.create({
					data: {
						name: name.trim(),
						quantity: parsedQuantity,
						notes:
							notes?.trim() || null,
						locationId:
							locationId || null,
						categoryId:
							categoryId || null,
						organizationId
					},
					include: {
						location: true,
						category: true
					}
				});

			await writeAudit({
				userId: req.user.id,
				organizationId,
				action: "CREATE",
				entityType: "INVENTORY_ITEM",
				entityId: item.id,
				afterData: cleanItem(item)
			});

			res.status(201).json(item);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error:
					"Unable to create inventory item"
			});
		}
	}
);


app.put(
	"/api/organizations/:organizationId/inventory/:itemId",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const { organizationId, itemId } =
				req.params;

			const {
				name,
				quantity,
				notes,
				locationId,
				categoryId
			} = req.body;

			const existingItem =
				await prisma.inventoryItem.findFirst({
					where: {
						id: itemId,
						organizationId
					}
				});

			if (!existingItem) {
				return res.status(404).json({
					error:
						"Inventory item not found"
				});
			}

			const parsedQuantity =
				quantity === undefined
					? existingItem.quantity
					: Number(quantity);

			if (
				!Number.isInteger(parsedQuantity) ||
				parsedQuantity < 0
			) {
				return res.status(400).json({
					error:
						"Quantity must be a whole number of zero or greater"
				});
			}

			if (locationId) {
				const location =
					await prisma.location.findFirst({
						where: {
							id: locationId,
							organizationId
						}
					});

				if (!location) {
					return res.status(400).json({
						error: "Invalid location"
					});
				}
			}

			if (categoryId) {
				const category =
					await prisma.category.findFirst({
						where: {
							id: categoryId,
							organizationId
						}
					});

				if (!category) {
					return res.status(400).json({
						error: "Invalid category"
					});
				}
			}

			const beforeData =
				cleanItem(existingItem);

			const item =
				await prisma.inventoryItem.update({
					where: {
						id: itemId
					},
					data: {
						name:
							name?.trim() ||
							existingItem.name,

						quantity:
							parsedQuantity,

						notes:
							notes !== undefined
								? notes?.trim() ||
									null
								: existingItem.notes,

						locationId:
							locationId !== undefined
								? locationId ||
									null
								: existingItem.locationId,

						categoryId:
							categoryId !== undefined
								? categoryId ||
									null
								: existingItem.categoryId
					},
					include: {
						location: true,
						category: true
					}
				});

			await writeAudit({
				userId: req.user.id,
				organizationId,
				action: "UPDATE",
				entityType: "INVENTORY_ITEM",
				entityId: item.id,
				beforeData,
				afterData: cleanItem(item)
			});

			res.json(item);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error:
					"Unable to update inventory item"
			});
		}
	}
);


app.delete(
	"/api/organizations/:organizationId/inventory/:itemId",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireMembership(req, res))) {
				return;
			}

			const { organizationId, itemId } =
				req.params;

			const item =
				await prisma.inventoryItem.findFirst({
					where: {
						id: itemId,
						organizationId
					}
				});

			if (!item) {
				return res.status(404).json({
					error:
						"Inventory item not found"
				});
			}

			const beforeData = cleanItem(item);

			await prisma.inventoryItem.delete({
				where: {
					id: item.id
				}
			});

			await writeAudit({
				userId: req.user.id,
				organizationId,
				action: "DELETE",
				entityType: "INVENTORY_ITEM",
				entityId: item.id,
				beforeData
			});

			res.json({
				message: "Inventory item deleted"
			});
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error:
					"Unable to delete inventory item"
			});
		}
	}
);


// ============================================================
// AUDIT HISTORY
// ============================================================

app.get(
	"/api/organizations/:organizationId/audit",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			const { userId, from } = req.query;

			const logs =
				await prisma.auditLog.findMany({
					where: {
						organizationId:
							req.params.organizationId,

						...(userId
							? { userId }
							: {}),

						...(from
							? {
									createdAt: {
										gte: new Date(from)
									}
								}
							: {})
					},

					include: {
						user: {
							select: {
								id: true,
								firstName: true,
								lastName: true,
								email: true
							}
						}
					},

					orderBy: {
						createdAt: "desc"
					},

					take: 500
				});

			res.json(logs);
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error:
					"Unable to load audit history"
			});
		}
	}
);


// ============================================================
// USER-SPECIFIC RECOVERY PREVIEW
// ============================================================

app.post(
	"/api/organizations/:organizationId/recovery/preview",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			const { userId, from } = req.body;

			if (!userId || !from) {
				return res.status(400).json({
					error:
						"User and recovery date/time are required"
				});
			}

			const date = new Date(from);

			if (Number.isNaN(date.getTime())) {
				return res.status(400).json({
					error: "Invalid recovery date/time"
				});
			}

			const logs = await prisma.auditLog.findMany({
				where: {
					organizationId: req.params.organizationId,
					userId,
					createdAt: {
						gte: date
					},
					entityType: {
						in: [
							"INVENTORY_ITEM",
							"LOCATION",
							"CATEGORY"
						]
					}
				},
				orderBy: {
					createdAt: "desc"
				}
			});

			res.json({
				count: logs.length,
				changes: logs
			});
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to preview recovery"
			});
		}
	}
);


// ============================================================
// USER-SPECIFIC RECOVERY EXECUTION
// ============================================================

app.post(
	"/api/organizations/:organizationId/recovery/execute",
	authenticate,
	async (req, res) => {
		try {
			if (!(await requireAdmin(req, res))) {
				return;
			}

			const { organizationId } = req.params;
			const { userId, from } = req.body;

			if (!userId || !from) {
				return res.status(400).json({
					error:
						"User and recovery date/time are required"
				});
			}


			const date = new Date(from);

			if (Number.isNaN(date.getTime())) {
				return res.status(400).json({
					error: "Invalid recovery date/time"
				});
			}

			const logs = await prisma.auditLog.findMany({
				where: {
					organizationId,
					userId,
					createdAt: {
						gte: date
					},
					entityType: {
						in: [
							"INVENTORY_ITEM",
							"LOCATION",
							"CATEGORY"
						]
					}
				},
				orderBy: {
					createdAt: "desc"
				}
			});

			let recovered = 0;
			let skipped = 0;

			const cleanLocation = (location) => {
				if (!location) return null;

				return {
					id: location.id,
					name: location.name,
					parentId: location.parentId,
					organizationId: location.organizationId
				};
			};

			const cleanCategory = (category) => {
				if (!category) return null;

				return {
					id: category.id,
					name: category.name,
					parentId: category.parentId,
					organizationId: category.organizationId
				};
			};

			const matchesSnapshot = (current, snapshot) =>
				JSON.stringify(current) ===
				JSON.stringify(snapshot);

			await prisma.$transaction(async (tx) => {
				for (const log of logs) {

					// ============================================
					// INVENTORY ITEMS
					// ============================================

					if (log.entityType === "INVENTORY_ITEM") {
						if (log.action === "CREATE") {
							const current =
								await tx.inventoryItem.findFirst({
									where: {
										id: log.entityId,
										organizationId
									}
								});

							if (!current) {
								skipped++;
								continue;
							}

							if (
								!matchesSnapshot(
									cleanItem(current),
									log.afterData
								)
							) {
								skipped++;
								continue;
							}

							await tx.inventoryItem.delete({
								where: {
									id: current.id
								}
							});

							recovered++;
							continue;
						}

						if (log.action === "UPDATE") {
							const current =
								await tx.inventoryItem.findFirst({
									where: {
										id: log.entityId,
										organizationId
									}
								});

							if (!current || !log.beforeData) {
								skipped++;
								continue;
							}

							if (
								!matchesSnapshot(
									cleanItem(current),
									log.afterData
								)
							) {
								skipped++;
								continue;
							}

							const before = log.beforeData;

							const location =
								before.locationId
									? await tx.location.findFirst({
											where: {
												id: before.locationId,
												organizationId
											}
										})
									: null;

							const category =
								before.categoryId
									? await tx.category.findFirst({
											where: {
												id: before.categoryId,
												organizationId
											}
										})
									: null;

							await tx.inventoryItem.update({
								where: {
									id: current.id
								},
								data: {
									name: before.name,
									quantity: before.quantity,
									notes: before.notes,
									locationId:
										location
											? before.locationId
											: null,
									categoryId:
										category
											? before.categoryId
											: null
								}
							});

							recovered++;
							continue;
						}

						if (log.action === "DELETE") {
							const existing =
								await tx.inventoryItem.findUnique({
									where: {
										id: log.entityId
									}
								});

							if (existing || !log.beforeData) {
								skipped++;
								continue;
							}

							const before = log.beforeData;

							const location =
								before.locationId
									? await tx.location.findFirst({
											where: {
												id: before.locationId,
												organizationId
											}
										})
									: null;

							const category =
								before.categoryId
									? await tx.category.findFirst({
											where: {
												id: before.categoryId,
												organizationId
											}
										})
									: null;

							await tx.inventoryItem.create({
								data: {
									id: before.id,
									name: before.name,
									quantity: before.quantity,
									notes: before.notes,
									organizationId,
									locationId:
										location
											? before.locationId
											: null,
									categoryId:
										category
											? before.categoryId
											: null
								}
							});

							recovered++;
							continue;
						}
					}


					// ============================================
					// LOCATIONS
					// ============================================

					if (log.entityType === "LOCATION") {
						if (log.action === "CREATE") {
							const current =
								await tx.location.findFirst({
									where: {
										id: log.entityId,
										organizationId
									}
								});

							if (!current) {
								skipped++;
								continue;
							}

							if (
								!matchesSnapshot(
									cleanLocation(current),
									log.afterData
								)
							) {
								skipped++;
								continue;
							}

							const locationsInside =
								await tx.location.count({
									where: {
										parentId: current.id,
										organizationId
									}
								});

							const inventoryInside =
								await tx.inventoryItem.count({
									where: {
										locationId: current.id,
										organizationId
									}
								});

							if (
								locationsInside > 0 ||
								inventoryInside > 0
							) {
								skipped++;
								continue;
							}

							await tx.location.delete({
								where: {
									id: current.id
								}
							});

							recovered++;
							continue;
						}

						if (log.action === "DELETE") {
							const existing =
								await tx.location.findUnique({
									where: {
										id: log.entityId
									}
								});

							if (existing || !log.beforeData) {
								skipped++;
								continue;
							}

							const before = log.beforeData;

							let parentId = null;

							if (before.parentId) {
								const parent =
									await tx.location.findFirst({
										where: {
											id: before.parentId,
											organizationId
										}
									});

								if (!parent) {
									skipped++;
									continue;
								}

								parentId = before.parentId;
							}

							await tx.location.create({
								data: {
									id: before.id,
									name: before.name,
									parentId,
									organizationId
								}
							});

							recovered++;
							continue;
						}
					}


					// ============================================
					// CATEGORIES
					// ============================================

					if (log.entityType === "CATEGORY") {
						if (log.action === "CREATE") {
							const current =
								await tx.category.findFirst({
									where: {
										id: log.entityId,
										organizationId
									}
								});

							if (!current) {
								skipped++;
								continue;
							}

							if (
								!matchesSnapshot(
									cleanCategory(current),
									log.afterData
								)
							) {
								skipped++;
								continue;
							}

							const categoriesInside =
								await tx.category.count({
									where: {
										parentId: current.id,
										organizationId
									}
								});

							const inventoryInside =
								await tx.inventoryItem.count({
									where: {
										categoryId: current.id,
										organizationId
									}
								});

							if (
								categoriesInside > 0 ||
								inventoryInside > 0
							) {
								skipped++;
								continue;
							}

							await tx.category.delete({
								where: {
									id: current.id
								}
							});

							recovered++;
							continue;
						}

						if (log.action === "DELETE") {
							const existing =
								await tx.category.findUnique({
									where: {
										id: log.entityId
									}
								});

							if (existing || !log.beforeData) {
								skipped++;
								continue;
							}

							const before = log.beforeData;

							let parentId = null;

							if (before.parentId) {
								const parent =
									await tx.category.findFirst({
										where: {
											id: before.parentId,
											organizationId
										}
									});

								if (!parent) {
									skipped++;
									continue;
								}

								parentId = before.parentId;
							}

							await tx.category.create({
								data: {
									id: before.id,
									name: before.name,
									parentId,
									organizationId
								}
							});

							recovered++;
							continue;
						}
					}

					skipped++;
				}

				await tx.auditLog.create({
					data: {
						userId: req.user.id,
						organizationId,
						action: "RECOVERY",
						entityType: "USER_CHANGES",
						entityId: userId,
						afterData: {
							from,
							recovered,
							skipped
						}
					}
				});
			});

			res.json({
				message: "Recovery completed",
				recovered,
				skipped
			});
		} catch (error) {
			console.error(error);

			res.status(500).json({
				error: "Unable to complete recovery"
			});
		}
	}
);
// ============================================================
// FALLBACK API ERROR
// ============================================================

app.use("/api", (req, res) => {
	res.status(404).json({
		error: "API route not found"
	});
});


// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
	console.log(
		`Inventory Tracker server is running on port ${PORT}`
	);
});