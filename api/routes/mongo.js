// Workflow 3 (nearest nurse) and Workflow 4 (faceted review analytics).

import { Router } from 'express';
import { mongo, pg } from '../db.js';
import { badRequest } from '../middleware/errors.js';
import { nearestNurses, reviewFacets } from '../pipelines/index.js';

const router = Router();

// --- Workflow 3: nearest nurse --------------------------------------

router.get('/nurses/near', async (req, res, next) => {
  try {
    let lat = Number(req.query.lat);
    let lng = Number(req.query.lng);
    const radius = Math.min(50000, Number(req.query.radius) || 5000);

    // Accept a clinic_id or patient_id instead of raw coordinates.
    if (req.query.clinic_id) {
      const { rows } = await pg.query(
        'SELECT latitude, longitude FROM clinics WHERE id = $1',
        [req.query.clinic_id]
      );
      if (!rows.length) throw badRequest('No such clinic.');
      lat = Number(rows[0].latitude);
      lng = Number(rows[0].longitude);
    } else if (req.query.patient_id) {
      const { rows } = await pg.query(
        'SELECT latitude, longitude FROM patients WHERE id = $1',
        [req.query.patient_id]
      );
      if (!rows.length || rows[0].latitude === null) {
        throw badRequest('That patient has no recorded location.');
      }
      lat = Number(rows[0].latitude);
      lng = Number(rows[0].longitude);
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw badRequest('Provide lat and lng, or a clinic_id, or a patient_id.');
    }

    const data = await mongo
      .collection('NursePings')
      .aggregate(nearestNurses(lng, lat, radius))
      .toArray();

    res.json({ origin: { lat, lng }, radius, data });
  } catch (err) { next(err); }
});

// --- Workflow 4: faceted review analytics ---------------------------

router.get('/clinics/:id/reviews/stats', async (req, res, next) => {
  try {
    const [result] = await mongo
      .collection('PatientReviews')
      .aggregate(reviewFacets(req.params.id))
      .toArray();

    // $bucket emits { _id, count }; tags emit { _id, frequency }.
    // Reshape so the chart code never deals with _id.
    const buckets = new Map(
      (result?.rating_distribution ?? [])
        .filter((b) => typeof b._id === 'number')
        .map((b) => [b._id, b.count])
    );

    res.json({
      clinic_id: req.params.id,
      rating_distribution: [1, 2, 3, 4, 5].map((r) => ({
        rating: r,
        count: buckets.get(r) ?? 0,
      })),
      frequent_tags: (result?.frequent_tags ?? []).map((t) => ({
        tag: t._id,
        frequency: t.frequency,
      })),
      average_rating: result?.global_average?.[0]?.average_rating ?? null,
      total_reviews: result?.global_average?.[0]?.total_reviews ?? 0,
    });
  } catch (err) { next(err); }
});

// --- recent review text for one clinic ------------------------------

router.get('/clinics/:id/reviews', async (req, res, next) => {
  try {
    const limit = Math.min(50, Number(req.query.limit) || 10);
    const data = await mongo
      .collection('PatientReviews')
      .find({ clinic_id: req.params.id })
      .project({ _id: 0, rating: 1, review_text: 1,
                 bedside_manner_tags: 1, created_at: 1 })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    res.json({ data });
  } catch (err) { next(err); }
});

// --- flexible catalog document --------------------------------------

router.get('/clinics/:id/catalog', async (req, res, next) => {
  try {
    const data = await mongo
      .collection('MedicalCatalogs')
      .find({ clinic_id: req.params.id })
      .project({ _id: 0 })
      .limit(10)
      .toArray();
    res.json({ clinic_id: req.params.id, data });
  } catch (err) { next(err); }
});

export default router;
