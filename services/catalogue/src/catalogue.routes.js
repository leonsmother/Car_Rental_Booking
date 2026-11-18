// Catalogue routes: which URL goes to which controller function (owner: Jana)
// Every route here must ALSO be listed in template.yaml before it works on AWS.

const express = require("express");
const controller = require("./catalogue.controller");
const { requireLogin, requireStaff } = require("./auth");

const router = express.Router();

// Public (anyone, no login)
router.get("/offices", controller.listOffices);            // C7
router.get("/offices/nearest", controller.nearestOffices); // C8 (uses Nominatim)
router.get("/cars", controller.searchCars);                // C1
router.get("/cars/:carId", controller.getCar);             // C2

// Staff only: login first (401), then staff check (403), then the controller
router.post("/cars", requireLogin, requireStaff, controller.createCar);                          // C3
router.put("/cars/:carId", requireLogin, requireStaff, controller.updateCar);                    // C4
router.delete("/cars/:carId", requireLogin, requireStaff, controller.retireCar);                 // C5
router.get("/offices/:officeId/cars", requireLogin, requireStaff, controller.listOfficeCars);    // C6
router.put("/offices/:officeId", requireLogin, requireStaff, controller.updateOffice);           // C9 (uses Nominatim)

module.exports = router;
