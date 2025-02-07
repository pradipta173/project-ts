const express = require("express");
const mysql = require("mysql");
const app = express();

require('dotenv').config();

// Create a MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

pool.getConnection(err => {
  if (err) {
    console.error("Database connection failed:", err);
    return;
  }
  console.log("Connected to MySQL!");
});

// Function to handle GET requests to /get_scene
app.get("/get_scene", (req, res) => {
  const sceneId = req.query.id;
  if (!sceneId) {
    res.status(400).json({ error: "Scene ID is required" });
    return;
  }

  let query;

  // Query to retrieve data from the panoramic table
  // if (sceneId === 1) {
    query = "SELECT * FROM panoramic WHERE id = ?";
  // } else {
  //   query = `
  //   SELECT
  //     panoramic.id, panoramic.image_name, panoramic.image_path,
  //     panoramic.image_timestamp,
  //     hotspots.gps_lat, hotspots.gps_long, hotspots.direction
  //   FROM hotspots
  //   JOIN panoramic ON panoramic.id = hotspots.target_panorama_id
  //   WHERE hotspots.target_panorama_id = ?;
  // `;
  // }

  pool.query(query, [sceneId], (err, results) => {
    if (err) {
      console.error("Database error query 1:", err);
      res.status(500).json({ error: "Database error" });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: "Scene not found" });
      return;
    }

    const row = results[0];
    
    const panoramaId = row.id;

    // Query to retrieve hotspots related to the panorama
    const hotspotQuery = `
SELECT *,
( 6371000 * ACOS( COS(RADIANS(?)) * COS(RADIANS(hotspots.gps_lat)) * COS(RADIANS(hotspots.gps_long) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(hotspots.gps_lat)) ) ) AS distance,
    ceil(MOD(
        DEGREES(
            ATAN2(
                SIN(RADIANS(hotspots.gps_long - ?)) * COS(RADIANS(hotspots.gps_lat)),
                COS(RADIANS(?)) * SIN(RADIANS(hotspots.gps_lat)) -
                SIN(RADIANS(?)) * COS(RADIANS(hotspots.gps_lat)) * COS(RADIANS(hotspots.gps_long - ?))
            )
        ) + 360, 
        360
    )) AS bearing_degrees
FROM hotspots
HAVING distance <= 20 and bearing_degrees > 0;
    `;
    pool.query(
      hotspotQuery,
      [
        row.gps_lat,
        row.gps_long,
        row.gps_lat,
        row.gps_long,
        row.gps_lat,
        row.gps_lat,
        row.gps_long,
      ],
      (err, hotspotResults) => {
        if (err) {
          console.error("Database error query 2:", err);
          res.status(500).json({ error: "Database error 2" });
          return;
        }
        let targetId
        let targetLat
        let targetLong
        const hotspots = [];
        hotspotResults.forEach((hotspot) => {
          if (hotspot.distance >= 5) {
            const bearingDegrees = calculateBearingDegrees(hotspot, row);
            const yaw = deg2rad(bearingDegrees);

            // Normalize yaw to the range -π to π
            if (yaw > Math.PI) {
              yaw -= 2 * Math.PI;
            } else if (yaw < -Math.PI) {
              yaw += 2 * Math.PI;
            }
            if (hotspot.target_panorama_id === panoramaId) {
              targetId = hotspot.panorama_id;
              targetLat = hotspot.gps_lat_alt;
              targetLong = hotspot.gps_long_alt;
            } else {
              targetId = hotspot.target_panorama_id;
              targetLat = hotspot.gps_lat;
              targetLong = hotspot.gps_long;
            }

            hotspots.push({
              target: targetId,
              yaw,
              pitch: 0,
              tooltip: "none",
              direction: bearingDegrees,
              latitude: targetLat,
              longitude: targetLong,
            });
          }
        });

        const initialView = {
          yaw: parseFloat(req.query.yaw),
          pitch: parseFloat(req.query.pitch),
          fov: 1.57,
        };

        const data = {
          id: row.id,
          title: row.image_name,
          image: row.image_path,
          latitude: row.gps_lat,
          longitude: row.gps_long,
          date: formatDate(row.image_timestamp),
          initialView,
          hotspots,
        };

        res.json(data);
      }
    );
  });
});

// Helper function to calculate bearing degrees
function calculateBearingDegrees(hotspot, row) {
  if (hotspot.bearing_degrees >= row.direction) {
    return hotspot.bearing_degrees - row.direction;
  } else if (hotspot.bearing_degrees < row.direction) {
    return row.direction - hotspot.bearing_degrees;
  } else {
    return row.direction;
  }
}

// Helper function to convert degrees to radians
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Helper function to format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
}

// Melayani file statis (gambar panorama)
app.use(express.static("public")); // Gambar panorama ada di folder 'public'

// Start the server
app.listen(process.env.PORT, () => {
  console.log(`Server started on port ${process.env.PORT}`);
});
