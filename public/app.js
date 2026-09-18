const authView = document.getElementById("auth-view");
const organizationView = document.getElementById("organization-view");
const inventoryView = document.getElementById("inventory-view");

const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const authMessage = document.getElementById("auth-message");

let token = localStorage.getItem("inventoryToken");
let currentOrganizationId = null;

function showLogin() {
	loginTab.classList.add("active");
	registerTab.classList.remove("active");
	loginForm.classList.remove("hidden");
	registerForm.classList.add("hidden");
	authMessage.textContent = "";
}

function showRegister() {
	registerTab.classList.add("active");
	loginTab.classList.remove("active");
	registerForm.classList.remove("hidden");
	loginForm.classList.add("hidden");
	authMessage.textContent = "";
}

loginTab.addEventListener("click", showLogin);
registerTab.addEventListener("click", showRegister);

loginForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	authMessage.textContent = "Signing in...";

	const response = await fetch("/api/login", {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			email: document.getElementById("login-email").value,
			password: document.getElementById("login-password").value
		})
	});

	const data = await response.json();

	if (!response.ok) {
		authMessage.textContent = data.error || "Unable to sign in.";
		return;
	}

	token = data.token;
	localStorage.setItem("inventoryToken", token);

	await loadAccount();
});

registerForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	authMessage.textContent = "Creating account...";

	const response = await fetch("/api/register", {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			firstName: document.getElementById("register-first-name").value,
			lastName: document.getElementById("register-last-name").value,
			email: document.getElementById("register-email").value,
			password: document.getElementById("register-password").value
		})
	});

	const data = await response.json();

	if (!response.ok) {
		authMessage.textContent = data.error || "Unable to create account.";
		return;
	}

	token = data.token;
	localStorage.setItem("inventoryToken", token);

	await loadAccount();
});

async function loadAccount() {
	if (!token) {
		showAuth();
		return;
	}

	try {
		const response = await fetch("/api/me", {
			headers: {
				Authorization: `Bearer ${token}`
			}
		});

		if (!response.ok) {
			localStorage.removeItem("inventoryToken");
			token = null;
			showAuth();
			return;
		}

		const user = await response.json();

		document.getElementById("user-name").textContent =
			`${user.firstName} ${user.lastName}`;

		if (!user.memberships || user.memberships.length === 0) {
			showOrganizationSetup();
			return;
		}

		const organization = user.memberships[0].organization;

currentOrganizationId = organization.id;

document.getElementById("organization-title").textContent =
	organization.name;

		showInventory();
	} catch (error) {
		console.error(error);
		showAuth();
	}
}

function showAuth() {
	authView.classList.remove("hidden");
	organizationView.classList.add("hidden");
	inventoryView.classList.add("hidden");
}

function showOrganizationSetup() {
	authView.classList.add("hidden");
	organizationView.classList.remove("hidden");
	inventoryView.classList.add("hidden");
}

function showInventory() {
	authView.classList.add("hidden");
	organizationView.classList.add("hidden");
	inventoryView.classList.remove("hidden");
    loadInventory();
}

document.getElementById("logout-button").addEventListener("click", () => {
	localStorage.removeItem("inventoryToken");
	token = null;
	showAuth();
	showLogin();
});

loadAccount();
const itemModal = document.getElementById("item-modal");
const addItemButton = document.getElementById("add-item-button");
const closeItemModal = document.getElementById("close-item-modal");

addItemButton.addEventListener("click", async () => {
	await loadLocations();
	itemModal.classList.remove("hidden");
});

closeItemModal.addEventListener("click", () => {
	itemModal.classList.add("hidden");
});

itemModal.addEventListener("click", (event) => {
	if (event.target === itemModal) {
		itemModal.classList.add("hidden");
	}
});
document.getElementById("add-item-form").addEventListener("submit", async (event) => {
	event.preventDefault();

	const itemMessage = document.getElementById("item-message");
	itemMessage.textContent = "Adding item...";

	try {
		const response = await fetch(
			`/api/organizations/${currentOrganizationId}/inventory`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`
				},
				body: JSON.stringify({
					name: document.getElementById("item-name").value,
					quantity: Number(document.getElementById("item-quantity").value),
					locationId: document.getElementById("item-location").value || null,
					notes: document.getElementById("item-notes").value
				})
			}
		);

		const data = await response.json();

		if (!response.ok) {
			itemMessage.textContent = data.error || "Unable to add item.";
			return;
		}

		document.getElementById("add-item-form").reset();
		document.getElementById("item-quantity").value = 1;
		itemMessage.textContent = "";
		itemModal.classList.add("hidden");

		await loadInventory();
	} catch (error) {
		console.error(error);
		itemMessage.textContent = "Unable to add item.";
	}
});
async function loadInventory() {
	if (!currentOrganizationId) return;

	const search = document.getElementById("inventory-search").value;
	const sort = document.getElementById("inventory-sort").value;

	try {
		const response = await fetch(
			`/api/organizations/${currentOrganizationId}/inventory?search=${encodeURIComponent(search)}&sort=${sort}`,
			{
				headers: {
					Authorization: `Bearer ${token}`
				}
			}
		);

		const items = await response.json();

		if (!response.ok) {
			console.error(items);
			return;
		}

		const inventoryList = document.getElementById("inventory-list");

		if (items.length === 0) {
			inventoryList.innerHTML = `
				<div class="empty-state">
					<h3>Your inventory is empty.</h3>
					<p>Add your first item to get started.</p>
				</div>
			`;
			return;
		}

		inventoryList.innerHTML = items.map((item) => `
			<div class="inventory-row">
				<div>
					<strong>${escapeHtml(item.name)}</strong>
					${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ""}
				</div>

				<span>${item.location ? escapeHtml(item.location.name) : "—"}</span>

				<span>${item.quantity}</span>

				<button
					class="text-button edit-item-button"
					data-id="${item.id}"
				>
					Edit
				</button>
			</div>
		`).join("");
	} catch (error) {
		console.error(error);
	}
}

function escapeHtml(value) {
	const div = document.createElement("div");
	div.textContent = value;
	return div.innerHTML;
}
async function loadLocations() {
	if (!currentOrganizationId) return;

	try {
		const response = await fetch(
			`/api/organizations/${currentOrganizationId}/locations`,
			{
				headers: {
					Authorization: `Bearer ${token}`
				}
			}
		);

		const locations = await response.json();

		if (!response.ok) {
			console.error(locations);
			return;
		}

		const locationSelect = document.getElementById("item-location");

		locationSelect.innerHTML = `
			<option value="">No location</option>
			${locations.map((location) => `
				<option value="${location.id}">
					${escapeHtml(location.name)}
				</option>
			`).join("")}
		`;
	} catch (error) {
		console.error(error);
	}
}
const locationsModal = document.getElementById("locations-modal");
const manageLocationsButton = document.getElementById("manage-locations-button");
const closeLocationsModal = document.getElementById("close-locations-modal");

manageLocationsButton.addEventListener("click", async () => {
	await loadLocationsManager();
	locationsModal.classList.remove("hidden");
});

closeLocationsModal.addEventListener("click", () => {
	locationsModal.classList.add("hidden");
});

locationsModal.addEventListener("click", (event) => {
	if (event.target === locationsModal) {
		locationsModal.classList.add("hidden");
	}
});async function loadLocationsManager() {
	if (!currentOrganizationId) return;

	const response = await fetch(
		`/api/organizations/${currentOrganizationId}/locations`,
		{
			headers: {
				Authorization: `Bearer ${token}`
			}
		}
	);

	const locations = await response.json();

	const parentSelect = document.getElementById("location-parent");
	const locationsList = document.getElementById("locations-list");

	parentSelect.innerHTML = `
		<option value="">Top-level location</option>
		${locations.map((location) => `
			<option value="${location.id}">
				${escapeHtml(location.name)}
			</option>
		`).join("")}
	`;

	locationsList.innerHTML = locations.length
		? locations.map((location) => `
			<div class="location-row">
				<strong>${escapeHtml(location.name)}</strong>
			</div>
		`).join("")
		: `<p>No locations yet.</p>`;
}document.getElementById("add-location-form").addEventListener("submit", async (event) => {
	event.preventDefault();

	const locationMessage = document.getElementById("location-message");

	const response = await fetch(
		`/api/organizations/${currentOrganizationId}/locations`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({
				name: document.getElementById("location-name").value,
				parentId: document.getElementById("location-parent").value || null
			})
		}
	);

	const data = await response.json();

	if (!response.ok) {
		locationMessage.textContent = data.error || "Unable to add location.";
		return;
	}

	document.getElementById("location-name").value = "";
	locationMessage.textContent = "";

	await loadLocationsManager();
});