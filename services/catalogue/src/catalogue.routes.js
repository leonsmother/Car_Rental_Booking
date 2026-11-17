const express = require("express");
const controller = require("./catalogue.controller");

const router = express.Router();

router.get("/offices", controller.listOffices); // C7 (anyone)
router.get("/cars", controller.searchCars);     // C1 (anyone)
router.get("/cars/:carId", controller.getCar);  // C2 (anyone)

module.exports = router;
