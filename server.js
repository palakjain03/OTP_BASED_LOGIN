
const express = require("express");
const cors = require("cors");
const auth = require("./routes/auth");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", auth);

app.listen(3000, () => console.log("Server running on port 3000"));
