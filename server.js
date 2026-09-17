const express = require("express");

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/", (req, res) => {
	res.send("Inventory Tracker is running!");
});

app.listen(PORT, () => {
	console.log(`Inventory Tracker server is running on port ${PORT}`);
});
