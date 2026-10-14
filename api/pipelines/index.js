// MongoDB aggregation pipelines, kept in one place so the Assignment 1
// scripts in mongo/ and the API share a single definition.

/**
 * Workflow 3 — nearest nurse.
 *
 * Same $geoNear as mongo/02_workflow3_geonear.js, with two changes:
 *   - the origin is a parameter instead of a hardcoded IIIT-H coordinate
 *   - $group by nurse_id replaces $limit: 1, so this returns the nearest
 *     NURSE rather than the nearest historical PING (handover D5/C4)
 *
 * $geoNear must be the first stage in the pipeline.
 */
export const nearestNurses = (lng, lat, maxDistance = 5000) => [
  {
    $geoNear: {
      near: { type: 'Point', coordinates: [lng, lat] },
      key: 'location',
      distanceField: 'distance',
      maxDistance,
      query: { active: true },
      spherical: true,
    },
  },
  { $sort: { nurse_id: 1, distance: 1 } },
  { $group: { _id: '$nurse_id', doc: { $first: '$$ROOT' } } },
  { $replaceRoot: { newRoot: '$doc' } },
  // attach the nurse's name and home clinic
  {
    $lookup: {
      from: 'Nurses',
      localField: 'nurse_id',
      foreignField: 'nurse_id',
      as: 'nurse',
    },
  },
  { $unwind: { path: '$nurse', preserveNullAndEmptyArrays: true } },
  {
    $project: {
      _id: 0,
      nurse_id: 1,
      location: 1,
      active: 1,
      created_at: 1,
      distance_m: { $round: ['$distance', 1] },
      name: '$nurse.name',
      phone: '$nurse.phone',
      home_clinic_name: '$nurse.home_clinic_name',
    },
  },
  { $sort: { distance_m: 1 } },
];

/**
 * Workflow 4 — faceted review analytics.
 *
 * Same three facets as mongo/03_workflow4_facet.js. The only addition is
 * an optional $match so the Reviews screen can scope to one clinic
 * (handover C7). With no clinicId the pipeline is identical to A1's and
 * a collection scan is the correct plan.
 *
 * $bucket boundaries run to 6 because upper bounds are exclusive — a
 * 5-star review needs the 6 to be counted.
 */
export const reviewFacets = (clinicId) => {
  const stages = [];
  if (clinicId) stages.push({ $match: { clinic_id: clinicId } });

  stages.push({
    $facet: {
      rating_distribution: [
        {
          $bucket: {
            groupBy: '$rating',
            boundaries: [1, 2, 3, 4, 5, 6],
            default: 'Unknown',
            output: { count: { $sum: 1 } },
          },
        },
      ],
      frequent_tags: [
        { $unwind: '$bedside_manner_tags' },
        { $group: { _id: '$bedside_manner_tags', frequency: { $sum: 1 } } },
        { $sort: { frequency: -1 } },
        { $limit: 5 },
      ],
      global_average: [
        {
          $group: {
            _id: null,
            average_rating: { $avg: '$rating' },
            total_reviews: { $sum: 1 },
          },
        },
      ],
    },
  });

  return stages;
};
