// ============================================================
// INVENTORY TRACKER — FRONTEND
// ============================================================

let token = localStorage.getItem("inventoryToken");
let currentUser = null;
let currentOrganizationId = null;
let currentRole = null;

let inventoryItems = [];
let locations = [];
let categories = [];
let members = [];
let invites = [];

let recoveryPreviewData = null;
let confirmCallback = null;
let searchTimer = null;
let returnToItemModal = false;


// ============================================================
// DOM HELPERS
// ============================================================

const $ = (id) => document.getElementById(id);

function show(element) {
	element?.classList.remove("hidden");
}

function hide(element) {
	element?.classList.add("hidden");
}

function escapeHtml(value = "") {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function formatDate(value) {
	if (!value) return "—";

	return new Date(value).toLocaleString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit"
	});
}

function setMessage(id, message = "", success = false) {
	const element = $(id);

	if (!element) return;

	element.textContent = message;
	element.classList.toggle("success", success);
}

function toast(message, error = false) {
	const element = $("toast");

	element.textContent = message;
	element.classList.toggle("error", error);

	show(element);

	clearTimeout(toast.timer);

	toast.timer = setTimeout(() => {
		hide(element);
	}, 3000);
}

function openConfirm(title, text, callback) {
	$("confirm-title").textContent = title;
	$("confirm-text").textContent = text;

	confirmCallback = callback;

	show($("confirm-modal"));
}

function closeConfirm() {
	hide($("confirm-modal"));
	confirmCallback = null;
}


// ============================================================
// API
// ============================================================

async function api(path, options = {}) {
	const headers = {
		...(options.body
			? { "Content-Type": "application/json" }
			: {}),
		...(token
			? { Authorization: `Bearer ${token}` }
			: {}),
		...(options.headers || {})
	};

	const response = await fetch(path, {
		...options,
		headers
	});

	let data = null;

	try {
		data = await response.json();
	} catch {
		data = null;
	}

	if (!response.ok) {
		if (response.status === 401 && token) {
			logout(false);
		}

		throw new Error(
			data?.error || "Something went wrong."
		);
	}

	return data;
}


// ============================================================
// AUTH VIEW
// ============================================================

function switchAuthTab(tab) {
	const login = tab === "login";

	$("login-tab").classList.toggle("active", login);
	$("register-tab").classList.toggle("active", !login);

	$("login-form").classList.toggle("hidden", !login);
	$("register-form").classList.toggle("hidden", login);

	setMessage("auth-message");
}

$("login-tab").addEventListener("click", () => {
	switchAuthTab("login");
});

$("register-tab").addEventListener("click", () => {
	switchAuthTab("register");
});


$("login-form").addEventListener("submit", async (event) => {
	event.preventDefault();

	setMessage("auth-message");

	try {
		const result = await api("/api/login", {
			method: "POST",
			body: JSON.stringify({
				email: $("login-email").value,
				password: $("login-password").value
			})
		});

		token = result.token;

		localStorage.setItem(
			"inventoryToken",
			token
		);

		await loadAccount();
	} catch (error) {
		setMessage("auth-message", error.message);
	}
});


$("register-form").addEventListener(
	"submit",
	async (event) => {
		event.preventDefault();

		setMessage("auth-message");

		try {
			const result = await api("/api/register", {
				method: "POST",
				body: JSON.stringify({
					firstName:
						$("register-first-name").value,
					lastName:
						$("register-last-name").value,
					email:
						$("register-email").value,
					password:
						$("register-password").value
				})
			});

			token = result.token;

			localStorage.setItem(
				"inventoryToken",
				token
			);

			await loadAccount();
		} catch (error) {
			setMessage("auth-message", error.message);
		}
	}
);


// ============================================================
// ACCOUNT / VIEW STATE
// ============================================================

async function loadAccount() {
	try {
		currentUser = await api("/api/me");

		hide($("auth-view"));

		if (!currentUser.memberships.length) {
			currentOrganizationId = null;
			currentRole = null;

			hide($("inventory-view"));
			show($("organization-view"));

			return;
		}

		const membership = currentUser.memberships[0];

		currentOrganizationId =
			membership.organization.id;

		currentRole = membership.role;

		showInventoryView(
			membership.organization
		);

		await loadInventory();
	} catch (error) {
		logout(false);

		setMessage(
			"auth-message",
			"Please sign in again."
		);
	}
}


function showInventoryView(organization) {
	hide($("auth-view"));
	hide($("organization-view"));
	show($("inventory-view"));

	$("organization-title").textContent =
		organization.name;

	$("user-name").textContent =
		`${currentUser.firstName} ${currentUser.lastName}`;

	$("user-email").textContent =
		currentUser.email;

	$("role-badge").textContent =
		currentRole;

	document
		.querySelectorAll(".admin-only")
		.forEach((element) => {
			element.classList.toggle(
				"hidden",
				currentRole !== "ADMIN"
			);
		});
}


function logout(showNotice = true) {
	token = null;
	currentUser = null;
	currentOrganizationId = null;
	currentRole = null;

	localStorage.removeItem("inventoryToken");

	hide($("organization-view"));
	hide($("inventory-view"));

	document
		.querySelectorAll(".modal")
		.forEach((modal) => hide(modal));

	show($("auth-view"));

	if (showNotice) {
		toast("Signed out.");
	}
}

$("logout-button").addEventListener("click", () => {
	logout();
});


// ============================================================
// ORGANIZATION SETUP
// ============================================================

$("create-organization-form").addEventListener(
	"submit",
	async (event) => {
		event.preventDefault();

		setMessage("organization-message");

		try {
			await api("/api/organizations", {
				method: "POST",
				body: JSON.stringify({
					name: $("organization-name").value
				})
			});

			$("create-organization-form").reset();

			await loadAccount();

			toast("Organization created.");
		} catch (error) {
			setMessage(
				"organization-message",
				error.message
			);
		}
	}
);


$("join-organization-form").addEventListener(
	"submit",
	async (event) => {
		event.preventDefault();

		setMessage("organization-message");

		try {
			await api("/api/organizations/join", {
				method: "POST",
				body: JSON.stringify({
					code: $("company-code").value
				})
			});

			$("join-organization-form").reset();

			await loadAccount();

			toast("Organization joined.");
		} catch (error) {
			setMessage(
				"organization-message",
				error.message
			);
		}
	}
);


// ============================================================
// INVENTORY
// ============================================================

async function loadInventory() {
	if (!currentOrganizationId) return;

	const search =
		$("inventory-search").value.trim();

	const sort =
		$("inventory-sort").value;

	$("inventory-list").innerHTML =
		`<div class="loading-state">Loading inventory...</div>`;

	try {
		const params = new URLSearchParams();

		if (search) {
			params.set("search", search);
		}

		params.set("sort", sort);

		inventoryItems = await api(
			`/api/organizations/${currentOrganizationId}/inventory?${params}`
		);

		renderInventory();
	} catch (error) {
		$("inventory-list").innerHTML =
			`<div class="empty-state">
				<h3>Unable to load inventory.</h3>
				<p>${escapeHtml(error.message)}</p>
			</div>`;
	}
}


function renderInventory() {
	const list = $("inventory-list");

	const totalQuantity =
		inventoryItems.reduce(
			(total, item) =>
				total + item.quantity,
			0
		);

	$("inventory-summary").textContent =
		`${inventoryItems.length} ${
			inventoryItems.length === 1
				? "item"
				: "items"
		} • ${totalQuantity} total units`;

	if (!inventoryItems.length) {
		list.innerHTML = `
			<div class="empty-state">
				<div class="empty-icon">□</div>
				<h3>No inventory found.</h3>
				<p>
					${
						$("inventory-search").value
							? "Try a different search."
							: "Add your first item to get started."
					}
				</p>
			</div>
		`;

		return;
	}

	list.innerHTML = inventoryItems
		.map(
			(item) => `
				<div class="inventory-row">

					<div class="item-name">
						<strong>${escapeHtml(item.name)}</strong>

						${
							item.notes
								? `<span class="item-notes">
									${escapeHtml(item.notes)}
								</span>`
								: ""
						}
					</div>

					<div class="item-meta">
						${escapeHtml(
							item.category?.name ||
								"Uncategorized"
						)}
					</div>

					<div class="item-meta">
						${escapeHtml(
							item.location?.name ||
								"No location"
						)}
					</div>

					<div>
						<span class="quantity-pill">
							${item.quantity}
						</span>
					</div>

					<div class="row-actions">
						<button
							class="row-button edit-item"
							data-id="${item.id}"
							type="button"
						>
							Edit
						</button>

						<button
							class="row-button danger delete-item"
							data-id="${item.id}"
							type="button"
						>
							Delete
						</button>
					</div>

				</div>
			`
		)
		.join("");
}


$("inventory-search").addEventListener(
	"input",
	() => {
		clearTimeout(searchTimer);

		searchTimer = setTimeout(
			loadInventory,
			250
		);
	}
);

$("inventory-sort").addEventListener(
	"change",
	loadInventory
);


// ============================================================
// QUICK ADD FROM INVENTORY ITEM
// ============================================================

$("quick-add-category").addEventListener(
	"click",
	async () => {
		returnToItemModal = true;

		hide($("item-modal"));

		try {
			await loadCategoriesManager();

			setMessage("category-message");

			show($("categories-modal"));
		} catch (error) {
			returnToItemModal = false;

			show($("item-modal"));

			toast(error.message, true);
		}
	}
);


$("quick-add-location").addEventListener(
	"click",
	async () => {
		returnToItemModal = true;

		hide($("item-modal"));

		try {
			await loadLocationsManager();

			setMessage("location-message");

			show($("locations-modal"));
		} catch (error) {
			returnToItemModal = false;

			show($("item-modal"));

			toast(error.message, true);
		}
	}
);


$("add-item-button").addEventListener(
	"click",
	async () => {
		await Promise.all([
			loadLocations(),
			loadCategories()
		]);

		$("item-form").reset();
		$("item-id").value = "";
		$("item-quantity").value = 1;

		$("item-modal-title").textContent =
			"Add Inventory Item";

		$("save-item-button").textContent =
			"Add Item";

		setMessage("item-message");

		show($("item-modal"));
	}
);


async function closeItemModal() {
	returnToItemModal = false;

	hide($("item-modal"));

	$("item-form").reset();
	$("item-id").value = "";

	setMessage("item-message");
}

$("close-item-modal").addEventListener(
	"click",
	closeItemModal
);

$("cancel-item-button").addEventListener(
	"click",
	closeItemModal
);


$("item-form").addEventListener(
	"submit",
	async (event) => {
		event.preventDefault();

		const itemId = $("item-id").value;

		const body = {
			name: $("item-name").value,
			quantity: Number(
				$("item-quantity").value
			),
			categoryId:
				$("item-category").value || null,
			locationId:
				$("item-location").value || null,
			notes: $("item-notes").value
		};

		try {
			if (itemId) {
				await api(
					`/api/organizations/${currentOrganizationId}/inventory/${itemId}`,
					{
						method: "PUT",
						body: JSON.stringify(body)
					}
				);

				toast("Item updated.");
			} else {
				await api(
					`/api/organizations/${currentOrganizationId}/inventory`,
					{
						method: "POST",
						body: JSON.stringify(body)
					}
				);

				toast("Item added.");
			}

			await closeItemModal();
			await loadInventory();
		} catch (error) {
			setMessage(
				"item-message",
				error.message
			);
		}
	}
);


$("inventory-list").addEventListener(
	"click",
	async (event) => {
		const editButton =
			event.target.closest(".edit-item");

		const deleteButton =
			event.target.closest(".delete-item");

		if (editButton) {
			const item =
				inventoryItems.find(
					(entry) =>
						entry.id ===
						editButton.dataset.id
				);

			if (!item) return;

			await Promise.all([
				loadLocations(),
				loadCategories()
			]);

			$("item-id").value = item.id;
			$("item-name").value = item.name;
			$("item-quantity").value =
				item.quantity;

			$("item-location").value =
				item.locationId || "";

			$("item-category").value =
				item.categoryId || "";

			$("item-notes").value =
				item.notes || "";

			$("item-modal-title").textContent =
				"Edit Inventory Item";

			$("save-item-button").textContent =
				"Save Changes";

			setMessage("item-message");

			show($("item-modal"));

			return;
		}

		if (deleteButton) {
			const item =
				inventoryItems.find(
					(entry) =>
						entry.id ===
						deleteButton.dataset.id
				);

			if (!item) return;

			openConfirm(
				"Delete inventory item?",
				`Delete "${item.name}"? This action will be recorded in the audit history and can be recovered by an administrator.`,
				async () => {
					await api(
						`/api/organizations/${currentOrganizationId}/inventory/${item.id}`,
						{
							method: "DELETE"
						}
					);

					toast("Item deleted.");

					await loadInventory();
				}
			);
		}
	}
);


// ============================================================
// TREE HELPERS
// ============================================================

function getTreeEntries(
	entries,
	parentId = null,
	depth = 0
) {
	let output = [];

	const children = entries
		.filter(
			(entry) =>
				(entry.parentId || null) === parentId
		)
		.sort((a, b) =>
			a.name.localeCompare(b.name)
		);

	for (const child of children) {
		output.push({
			...child,
			depth
		});

		output = output.concat(
			getTreeEntries(
				entries,
				child.id,
				depth + 1
			)
		);
	}

	return output;
}


function renderTreeOptions(
	select,
	entries,
	defaultText
) {
	const tree = getTreeEntries(entries);

	select.innerHTML = `
		<option value="">
			${escapeHtml(defaultText)}
		</option>

		${tree
			.map(
				(entry) => `
					<option value="${entry.id}">
						${"— ".repeat(entry.depth)}
						${escapeHtml(entry.name)}
					</option>
				`
			)
			.join("")}
	`;
}


function renderManagerTree(
	container,
	entries,
	deleteClass
) {
	const tree = getTreeEntries(entries);

	if (!tree.length) {
		container.innerHTML = `
			<div class="empty-state">
				<p>Nothing here yet.</p>
			</div>
		`;

		return;
	}

	container.innerHTML = tree
		.map(
			(entry) => `
				<div
					class="manager-row"
					style="padding-left: ${
						12 +
						entry.depth * 24
					}px"
				>
					<div class="manager-name">
						${
							entry.depth
								? `<span class="tree-arrow">↳</span>`
								: ""
						}

						<strong>
							${escapeHtml(entry.name)}
						</strong>
					</div>

					<button
						class="manager-delete ${deleteClass}"
						data-id="${entry.id}"
						data-name="${escapeHtml(entry.name)}"
						type="button"
					>
						Delete
					</button>
				</div>
			`
		)
		.join("");
}


// ============================================================
// LOCATIONS
// ============================================================

async function loadLocations() {
	locations = await api(
		`/api/organizations/${currentOrganizationId}/locations`
	);

	renderTreeOptions(
		$("item-location"),
		locations,
		"No location"
	);

	return locations;
}


async function loadLocationsManager() {
	await loadLocations();

	renderTreeOptions(
		$("location-parent"),
		locations,
		"Top-level location"
	);

	renderManagerTree(
		$("locations-list"),
		locations,
		"delete-location"
	);
}


$("manage-locations-button").addEventListener(
	"click",
	async () => {
		returnToItemModal = false;

		try {
			await loadLocationsManager();

			setMessage("location-message");

			show($("locations-modal"));
		} catch (error) {
			toast(error.message, true);
		}
	}
);


$("close-locations-modal").addEventListener(
	"click",
	async () => {
		hide($("locations-modal"));

		if (returnToItemModal) {
			returnToItemModal = false;

			await loadLocations();

			show($("item-modal"));
		}
	}
);


$("add-location-form").addEventListener(
	"submit",
	async (event) => {
		event.preventDefault();

		setMessage("location-message");

		try {
			const newLocation = await api(
				`/api/organizations/${currentOrganizationId}/locations`,
				{
					method: "POST",
					body: JSON.stringify({
						name:
							$("location-name").value,
						parentId:
							$("location-parent").value ||
							null
					})
				}
			);

			$("location-name").value = "";

			await loadLocationsManager();

			if (returnToItemModal) {
				returnToItemModal = false;

				$("item-location").value =
					newLocation.id;

				hide($("locations-modal"));
				show($("item-modal"));

				toast(
					"Location added and selected."
				);

				return;
			}

			toast("Location added.");
		} catch (error) {
			setMessage(
				"location-message",
				error.message
			);
		}
	}
);


$("locations-list").addEventListener(
	"click",
	(event) => {
		const button =
			event.target.closest(
				".delete-location"
			);

		if (!button) return;

		openConfirm(
	"Delete location and everything inside?",
	`Delete "${button.dataset.name}"? This will permanently remove this location, every location inside it, and all inventory stored in those locations. This action will be recorded in the audit history.`,
			async () => {
				await api(
					`/api/organizations/${currentOrganizationId}/locations/${button.dataset.id}`,
					{
						method: "DELETE"
					}
				);

				await loadLocationsManager();
				await loadInventory();

				toast("Location deleted.");
			}
		);
	}
);


// ============================================================
// CATEGORIES
// ============================================================

async function loadCategories() {
	categories = await api(
		`/api/organizations/${currentOrganizationId}/categories`
	);

	renderTreeOptions(
		$("item-category"),
		categories,
		"No category"
	);

	return categories;
}


async function loadCategoriesManager() {
	await loadCategories();

	renderTreeOptions(
		$("category-parent"),
		categories,
		"Top-level category"
	);

	renderManagerTree(
		$("categories-list"),
		categories,
		"delete-category"
	);
}


$("manage-categories-button").addEventListener(
	"click",
	async () => {
		returnToItemModal = false;

		try {
			await loadCategoriesManager();

			setMessage("category-message");

			show($("categories-modal"));
		} catch (error) {
			toast(error.message, true);
		}
	}
);


$("close-categories-modal").addEventListener(
	"click",
	async () => {
		hide($("categories-modal"));

		if (returnToItemModal) {
			returnToItemModal = false;

			await loadCategories();

			show($("item-modal"));
		}
	}
);


$("add-category-form").addEventListener(
	"submit",
	async (event) => {
		event.preventDefault();

		setMessage("category-message");

		try {
			const newCategory = await api(
				`/api/organizations/${currentOrganizationId}/categories`,
				{
					method: "POST",
					body: JSON.stringify({
						name:
							$("category-name").value,
						parentId:
							$("category-parent").value ||
							null
					})
				}
			);

			$("category-name").value = "";

			await loadCategoriesManager();

			if (returnToItemModal) {
				returnToItemModal = false;

				$("item-category").value =
					newCategory.id;

				hide($("categories-modal"));
				show($("item-modal"));

				toast(
					"Category added and selected."
				);

				return;
			}

			toast("Category added.");
		} catch (error) {
			setMessage(
				"category-message",
				error.message
			);
		}
	}
);


$("categories-list").addEventListener(
	"click",
	(event) => {
		const button =
			event.target.closest(
				".delete-category"
			);

		if (!button) return;

		openConfirm(
			"Delete category?",
			`Delete "${button.dataset.name}"? You must first remove any inventory or categories inside it.`,
			async () => {
				await api(
					`/api/organizations/${currentOrganizationId}/categories/${button.dataset.id}`,
					{
						method: "DELETE"
					}
				);

				await loadCategoriesManager();
				await loadInventory();

				toast("Category deleted.");
			}
		);
	}
);
// ============================================================
// ADMIN MODAL
// ============================================================

$("admin-button").addEventListener(
	"click",
	async () => {
		try {
			await loadMembers();

			switchAdminPanel("team-panel");

			show($("admin-modal"));
		} catch (error) {
			toast(error.message, true);
		}
	}
);


$("close-admin-modal").addEventListener(
	"click",
	() => hide($("admin-modal"))
);


document
	.querySelectorAll(".admin-tab")
	.forEach((button) => {
		button.addEventListener(
			"click",
			async () => {
				const panel =
					button.dataset.adminPanel;

				switchAdminPanel(panel);

				try {
					if (panel === "team-panel") {
						await loadMembers();
					}

					if (panel === "invite-panel") {
						await loadInvites();
					}

					if (panel === "history-panel") {
						await loadMembers();
						await loadAuditHistory();
					}

					if (panel === "recovery-panel") {
						await loadMembers();
						resetRecoveryPreview();
					}
				} catch (error) {
					toast(error.message, true);
				}
			}
		);
	});


function switchAdminPanel(panelId) {
	document
		.querySelectorAll(".admin-panel")
		.forEach((panel) => {
			panel.classList.toggle(
				"hidden",
				panel.id !== panelId
			);
		});

	document
		.querySelectorAll(".admin-tab")
		.forEach((button) => {
			button.classList.toggle(
				"active",
				button.dataset.adminPanel ===
					panelId
			);
		});
}


// ============================================================
// ADMIN — MEMBERS
// ============================================================

async function loadMembers() {
	members = await api(
		`/api/organizations/${currentOrganizationId}/members`
	);

	renderMembers();
	populateMemberFilters();

	return members;
}


function renderMembers() {
	const list = $("members-list");

	if (!members.length) {
		list.innerHTML =
			`<div class="empty-state">
				<p>No members found.</p>
			</div>`;

		return;
	}

	list.innerHTML = members
		.map((membership) => {
			const isCurrentUser =
				membership.user.id ===
				currentUser.id;

			return `
				<div class="member-row">

					<div class="member-info">
						<strong>
							${escapeHtml(
								membership.user.firstName
							)}
							${escapeHtml(
								membership.user.lastName
							)}
							${isCurrentUser ? " (You)" : ""}
						</strong>

						<span>
							${escapeHtml(
								membership.user.email
							)}
						</span>
					</div>

					<select
						class="member-role"
						data-membership-id="${membership.id}"
						${isCurrentUser ? "disabled" : ""}
					>
						<option
							value="MEMBER"
							${
								membership.role === "MEMBER"
									? "selected"
									: ""
							}
						>
							Member
						</option>

						<option
							value="ADMIN"
							${
								membership.role === "ADMIN"
									? "selected"
									: ""
							}
						>
							Admin
						</option>
					</select>

					<div class="member-actions">
						${
							isCurrentUser
								? `<span class="status-badge active">
									Your Account
								</span>`
								: `<button
									class="row-button danger remove-member"
									data-membership-id="${membership.id}"
									data-name="${escapeHtml(
										`${membership.user.firstName} ${membership.user.lastName}`
									)}"
									type="button"
								>
									Remove
								</button>`
						}
					</div>

				</div>
			`;
		})
		.join("");
}


function populateMemberFilters() {
	const historyValue =
		$("history-user-filter").value;

	const recoveryValue =
		$("recovery-user").value;

	const options = members
		.map(
			(membership) => `
				<option value="${membership.user.id}">
					${escapeHtml(
						membership.user.firstName
					)}
					${escapeHtml(
						membership.user.lastName
					)}
				</option>
			`
		)
		.join("");

	$("history-user-filter").innerHTML =
		`<option value="">Everyone</option>${options}`;

	$("recovery-user").innerHTML =
		`<option value="">Choose employee</option>${options}`;

	if (
		[...$("history-user-filter").options]
			.some(
				(option) =>
					option.value === historyValue
			)
	) {
		$("history-user-filter").value =
			historyValue;
	}

	if (
		[...$("recovery-user").options]
			.some(
				(option) =>
					option.value === recoveryValue
			)
	) {
		$("recovery-user").value =
			recoveryValue;
	}
}


$("members-list").addEventListener(
	"change",
	async (event) => {
		const select =
			event.target.closest(".member-role");

		if (!select) return;

		try {
			await api(
				`/api/organizations/${currentOrganizationId}/members/${select.dataset.membershipId}`,
				{
					method: "PUT",
					body: JSON.stringify({
						role: select.value
					})
				}
			);

			await loadMembers();

			toast("Member role updated.");
		} catch (error) {
			toast(error.message, true);
			await loadMembers();
		}
	}
);


$("members-list").addEventListener(
	"click",
	(event) => {
		const button =
			event.target.closest(".remove-member");

		if (!button) return;

		openConfirm(
			"Remove team member?",
			`Remove ${button.dataset.name} from this organization? Their audit history will remain available.`,
			async () => {
				await api(
					`/api/organizations/${currentOrganizationId}/members/${button.dataset.membershipId}`,
					{
						method: "DELETE"
					}
				);

				await loadMembers();

				toast("Member removed.");
			}
		);
	}
);


// ============================================================
// ADMIN — INVITE CODES
// ============================================================

async function loadInvites() {
	invites = await api(
		`/api/organizations/${currentOrganizationId}/invites`
	);

	renderInvites();
}


function renderInvites() {
	const active = invites.find(
		(invite) =>
			invite.active &&
			(!invite.expiresAt ||
				new Date(invite.expiresAt) >
					new Date())
	);

	$("active-invite-code").textContent =
		active?.code || "NO ACTIVE CODE";

	$("copy-invite-button").disabled =
		!active;

	const list = $("invites-list");

	if (!invites.length) {
		list.innerHTML =
			`<div class="empty-state">
				<p>No company codes yet.</p>
			</div>`;

		return;
	}

	list.innerHTML = invites
		.map(
			(invite) => `
				<div class="invite-row">

					<strong>
						${escapeHtml(invite.code)}
					</strong>

					<span class="status-badge ${
						invite.active
							? "active"
							: "inactive"
					}">
						${
							invite.active
								? "Active"
								: "Inactive"
						}
					</span>

					<span>
						${formatDate(invite.createdAt)}
					</span>

				</div>
			`
		)
		.join("");
}


$("generate-invite-button").addEventListener(
	"click",
	() => {
		openConfirm(
			"Generate a new company code?",
			"The current active company code will be disabled. Employees who already joined will not be affected.",
			async () => {
				await api(
					`/api/organizations/${currentOrganizationId}/invites`,
					{
						method: "POST"
					}
				);

				await loadInvites();

				toast("New company code generated.");
			}
		);
	}
);


$("copy-invite-button").addEventListener(
	"click",
	async () => {
		const code =
			$("active-invite-code").textContent;

		if (!code || code === "NO ACTIVE CODE") {
			return;
		}

		try {
			await navigator.clipboard.writeText(code);

			toast("Company code copied.");
		} catch {
			toast(
				"Unable to copy automatically.",
				true
			);
		}
	}
);


// ============================================================
// ADMIN — AUDIT HISTORY
// ============================================================

async function loadAuditHistory() {
	const params = new URLSearchParams();

	const userId =
		$("history-user-filter").value;

	const from =
		$("history-from-filter").value;

	if (userId) {
		params.set("userId", userId);
	}

	if (from) {
		params.set(
			"from",
			new Date(from).toISOString()
		);
	}

	setMessage("history-message");

	try {
		const logs = await api(
			`/api/organizations/${currentOrganizationId}/audit?${params}`
		);

		renderAuditLogs(logs);
	} catch (error) {
		setMessage(
			"history-message",
			error.message
		);
	}
}

function auditDescription(log) {
	const userName = log.user
		? `${log.user.firstName} ${log.user.lastName}`
		: "Unknown user";

	const before = log.beforeData || {};
	const after = log.afterData || {};

	const itemName =
		after.name ||
		before.name ||
		log.entityType
			.replaceAll("_", " ")
			.toLowerCase();

	if (log.action === "CREATE") {
		return `${userName} added ${itemName}`;
	}

	if (log.action === "DELETE") {
		return `${userName} deleted ${itemName}`;
	}

	if (log.action === "UPDATE") {
		const changes = [];

		if (before.name !== after.name) {
			changes.push(
				`Name: ${before.name || "None"} → ${after.name || "None"}`
			);
		}

		if (before.quantity !== after.quantity) {
			changes.push(
				`Quantity: ${before.quantity ?? 0} → ${after.quantity ?? 0}`
			);
		}

		if (before.notes !== after.notes) {
			changes.push(
				`Notes: ${before.notes || "None"} → ${after.notes || "None"}`
			);
		}

		if (before.locationId !== after.locationId) {
			changes.push("Location changed");
		}

		if (before.categoryId !== after.categoryId) {
			changes.push("Category changed");
		}

		if (changes.length) {
			return `${userName} updated ${itemName} — ${changes.join("; ")}`;
		}

		return `${userName} updated ${itemName}`;
	}

	if (log.action === "RECOVERY") {
		return `${userName} performed a recovery`;
	}

	return `${userName} ${log.action.toLowerCase()} ${itemName}`;
}


function renderAuditLogs(logs) {
	const list = $("audit-list");

	if (!logs.length) {
		list.innerHTML = `
			<div class="empty-state">
				<p>No history matches these filters.</p>
			</div>
		`;

		return;
	}

	list.innerHTML = logs
		.map(
			(log) => `
				<div class="audit-row">

					<div class="audit-action">
						<span class="audit-dot ${
							log.action.toLowerCase()
						}"></span>

						${escapeHtml(log.action)}
					</div>

					<div class="audit-description">
						${escapeHtml(
							auditDescription(log)
						)}
					</div>

					<div class="audit-time">
						${formatDate(log.createdAt)}
					</div>

				</div>
			`
		)
		.join("");
}


$("refresh-history-button").addEventListener(
	"click",
	loadAuditHistory
);

$("history-user-filter").addEventListener(
	"change",
	loadAuditHistory
);

$("history-from-filter").addEventListener(
	"change",
	loadAuditHistory
);


// ============================================================
// ADMIN — RECOVERY
// ============================================================

function resetRecoveryPreview() {
	recoveryPreviewData = null;

	hide($("recovery-preview"));

	$("recovery-changes").innerHTML = "";
	$("recovery-count").textContent = "";

	setMessage("recovery-message");
}


$("recovery-user").addEventListener(
	"change",
	resetRecoveryPreview
);

$("recovery-from").addEventListener(
	"change",
	resetRecoveryPreview
);


$("preview-recovery-button").addEventListener(
	"click",
	async () => {
		const userId =
			$("recovery-user").value;

		const from =
			$("recovery-from").value;

		if (!userId || !from) {
			setMessage(
				"recovery-message",
				"Choose an employee and date/time first."
			);

			return;
		}

		try {
			recoveryPreviewData = await api(
				`/api/organizations/${currentOrganizationId}/recovery/preview`,
				{
					method: "POST",
					body: JSON.stringify({
						userId,
						from:
							new Date(from).toISOString()
					})
				}
			);

			renderRecoveryPreview(
				recoveryPreviewData
			);
		} catch (error) {
			setMessage(
				"recovery-message",
				error.message
			);
		}
	}
);


function renderRecoveryPreview(data) {
	show($("recovery-preview"));

	$("recovery-count").textContent =
		`${data.count} ${
			data.count === 1
				? "change"
				: "changes"
		} found`;

	$("execute-recovery-button").disabled =
		data.count === 0;

	if (!data.changes.length) {
		$("recovery-changes").innerHTML = `
			<div class="empty-state">
				<p>No inventory changes to recover.</p>
			</div>
		`;

		return;
	}

	$("recovery-changes").innerHTML =
		data.changes
			.map(
				(log) => {
					const name =
						log.afterData?.name ||
						log.beforeData?.name ||
						"Inventory item";

					return `
						<div class="audit-row">

							<div class="audit-action">
								<span class="audit-dot ${
									log.action.toLowerCase()
								}"></span>

								${escapeHtml(log.action)}
							</div>

							<div class="audit-description">
								${escapeHtml(name)}
							</div>

							<div class="audit-time">
								${formatDate(
									log.createdAt
								)}
							</div>

						</div>
					`;
				}
			)
			.join("");
}


$("execute-recovery-button").addEventListener(
	"click",
	() => {
		const userId =
			$("recovery-user").value;

		const from =
			$("recovery-from").value;

		if (
			!userId ||
			!from ||
			!recoveryPreviewData?.count
		) {
			return;
		}

		const member =
			members.find(
				(entry) =>
					entry.user.id === userId
			);

		const name = member
			? `${member.user.firstName} ${member.user.lastName}`
			: "this employee";

		openConfirm(
			"Confirm user-specific recovery?",
			`Reverse recoverable inventory changes made by ${name} from the selected date/time forward? Changes made later by other employees will be preserved when they conflict.`,
			async () => {
				const result = await api(
					`/api/organizations/${currentOrganizationId}/recovery/execute`,
					{
						method: "POST",
						body: JSON.stringify({
							userId,
							from:
								new Date(
									from
								).toISOString()
						})
					}
				);

				resetRecoveryPreview();

				await loadInventory();

				toast(
					`Recovery complete: ${result.recovered} reversed, ${result.skipped} preserved/skipped.`
				);
			}
		);
	}
);


// ============================================================
// CONFIRMATION MODAL
// ============================================================

$("confirm-cancel-button").addEventListener(
	"click",
	closeConfirm
);


$("confirm-action-button").addEventListener(
	"click",
	async () => {
		const callback = confirmCallback;

		closeConfirm();

		if (!callback) return;

		try {
			await callback();
		} catch (error) {
			toast(error.message, true);
		}
	}
);


// ============================================================
// MODAL CLOSING
// ============================================================

function closeStandardModal(modal) {
	if (!modal) return;

	/*
		If the user opened Locations or Categories from
		the Add Item form, closing that manager should
		return them to their unfinished item instead of
		throwing their work away.
	*/

	if (
		returnToItemModal &&
		(
			modal.id === "locations-modal" ||
			modal.id === "categories-modal"
		)
	) {
		hide(modal);
		returnToItemModal = false;
		show($("item-modal"));
		return;
	}

	hide(modal);
}


[
	"item-modal",
	"locations-modal",
	"categories-modal",
	"admin-modal"
].forEach((id) => {
	const modal = $(id);

	modal.addEventListener(
		"click",
		(event) => {
			if (event.target !== modal) return;

			if (modal.id === "item-modal") {
				closeItemModal();
				return;
			}

			closeStandardModal(modal);
		}
	);
});


// ============================================================
// ESCAPE KEY
// ============================================================

document.addEventListener(
	"keydown",
	(event) => {
		if (event.key !== "Escape") return;

		const visibleModal =
			[...document.querySelectorAll(".modal")]
				.find(
					(modal) =>
						!modal.classList.contains(
							"hidden"
						)
				);

		if (!visibleModal) return;

		if (visibleModal.id === "confirm-modal") {
			closeConfirm();
			return;
		}

		if (visibleModal.id === "item-modal") {
			closeItemModal();
			return;
		}

		closeStandardModal(visibleModal);
	}
);


// ============================================================
// START APPLICATION
// ============================================================

async function startApp() {
	if (!token) {
		show($("auth-view"));
		hide($("organization-view"));
		hide($("inventory-view"));

		return;
	}

	await loadAccount();
}

startApp();