import "dotenv/config";
import express from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

const adapter = new PrismaPg({
	connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/", (req, res) => {
	res.send("Inventory Tracker is running!");
});
app.get("/test-db", async (req, res) => {
	try {
		const organizations = await prisma.organization.findMany();
		res.json(organizations);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Database connection failed" });
	}
});
app.listen(PORT, () => {
	console.log(`Inventory Tracker server is running on port ${PORT}`);
});