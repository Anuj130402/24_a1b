// ============================================================
// Assignment 2 additions — MongoDB
// ------------------------------------------------------------
// mongo/01..03 are left untouched. Everything A2 needs that A1
// did not provide lives here.
//
//   mongosh mongo/04_a2_additions.js
//
// Run AFTER mongo/01_collections_and_indexes.js and AFTER the
// revised data_generation/mongo_seeder.py.
//
// Change IDs refer to docs/handover_note.md section 5.
// ============================================================

db = db.getSiblingDB("careconnect_db");

// ------------------------------------------------------------
// C3 — widen the TTL from 2 hours to 24 hours
// ------------------------------------------------------------
// A1 stamped pings within the last 119 minutes against a 7200s
// TTL, so the entire 500,000-document collection disappeared
// roughly two hours after seeding and the map went blank.
// expireAfterSeconds can be changed in place with collMod; the
// index does not need to be dropped.
// ------------------------------------------------------------
const TTL_SECONDS = 86400;

const ttlIndex = db.NursePings.getIndexes()
    .find(ix => ix.name === "created_at_1");

if (!ttlIndex) {
    db.NursePings.createIndex(
        { created_at: 1 },
        { expireAfterSeconds: TTL_SECONDS }
    );
    print(`created TTL index on NursePings.created_at (${TTL_SECONDS}s)`);
} else if (ttlIndex.expireAfterSeconds !== TTL_SECONDS) {
    db.runCommand({
        collMod: "NursePings",
        index: { keyPattern: { created_at: 1 }, expireAfterSeconds: TTL_SECONDS }
    });
    print(`TTL widened ${ttlIndex.expireAfterSeconds}s -> ${TTL_SECONDS}s`);
} else {
    print(`TTL already ${TTL_SECONDS}s`);
}


// ------------------------------------------------------------
// C7 — index PatientReviews for per-clinic analytics
// ------------------------------------------------------------
// A1's $facet pipeline has no $match, so it reports globally and
// a collection scan is correct for it. The Reviews screen asks
// for ONE clinic, which needs this index.
// ------------------------------------------------------------
db.PatientReviews.createIndex({ clinic_id: 1 });
db.PatientReviews.createIndex({ clinic_id: 1, created_at: -1 });
print("indexed PatientReviews.clinic_id");


// ------------------------------------------------------------
// C1 — index the catalog lookup
// ------------------------------------------------------------
db.MedicalCatalogs.createIndex({ clinic_id: 1 });
print("indexed MedicalCatalogs.clinic_id");


// ------------------------------------------------------------
// C4 — Nurses is an entity collection now
// ------------------------------------------------------------
db.Nurses.createIndex({ nurse_id: 1 }, { unique: true });
db.NursePings.createIndex({ nurse_id: 1, created_at: -1 });
print("indexed Nurses.nurse_id and NursePings.nurse_id");


// ------------------------------------------------------------
// C13 — apply mongo_schema_map.json as real validators
// ------------------------------------------------------------
// A1 shipped the file as documentation only; nothing enforced
// document shape at write time. These are the same required
// fields, expressed as $jsonSchema.
// ------------------------------------------------------------
function applyValidator(name, schema) {
    db.runCommand({
        collMod: name,
        validator: { $jsonSchema: schema },
        validationLevel: "moderate",   // existing docs are not re-checked
        validationAction: "error"
    });
    print(`validator applied to ${name}`);
}

applyValidator("PatientReviews", {
    bsonType: "object",
    required: ["appointment_id", "patient_id", "clinic_id",
               "rating", "bedside_manner_tags", "review_text", "created_at"],
    properties: {
        appointment_id: { bsonType: "string" },
        patient_id:     { bsonType: "string" },
        clinic_id:      { bsonType: "string" },
        // int|long|double: PyMongo's integer width is not guaranteed,
        // and a validator that rejects a valid rating is worse than one
        // that is slightly loose about its storage type.
        rating:         { bsonType: ["int", "long", "double"],
                          minimum: 1, maximum: 5 },
        bedside_manner_tags: { bsonType: "array", items: { bsonType: "string" } },
        review_text:    { bsonType: "string" },
        created_at:     { bsonType: "date" }
    }
});

applyValidator("NursePings", {
    bsonType: "object",
    required: ["nurse_id", "active", "location", "created_at"],
    properties: {
        nurse_id: { bsonType: "string" },
        active:   { bsonType: "bool" },
        location: {
            bsonType: "object",
            required: ["type", "coordinates"],
            properties: {
                type:        { enum: ["Point"] },
                coordinates: { bsonType: "array", minItems: 2, maxItems: 2 }
            }
        },
        created_at: { bsonType: "date" }
    }
});

applyValidator("MedicalCatalogs", {
    bsonType: "object",
    required: ["clinic_id", "specialist_name", "specialty",
               "availability", "medications_handled"],
    properties: {
        clinic_id:       { bsonType: "string" },
        specialist_name: { bsonType: "string" },
        specialty:       { bsonType: "string" },
        availability:    { bsonType: "array" },
        medications_handled: { bsonType: "array" }
    }
});


// ------------------------------------------------------------
// Report
// ------------------------------------------------------------
print("");
print("Nurses:          " + db.Nurses.countDocuments());
print("NursePings:      " + db.NursePings.countDocuments());
print("PatientReviews:  " + db.PatientReviews.countDocuments());
print("MedicalCatalogs: " + db.MedicalCatalogs.countDocuments());
print("");
print("04_a2_additions.js applied.");
