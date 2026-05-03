// controllers/searchController.js — FIXED
// Normalisasi response agar cocok dengan index.html
// index.html expects: searchData?.result (array)
// appleSearch.search() returns: { status, query, region, total, data: [...] }

const appleSearch = require('../services/appleSearch');

exports.search = async (req, res, next) => {
    try {
        const { q, region = 'id' } = req.query;

        if (!q || q.trim().length === 0) {
            return res.status(400).json({
                status: false,
                message: 'Parameter q (query) diperlukan'
            });
        }

        const results = await appleSearch.search(q.trim(), region);

        // PENTING: index.html pakai searchData?.result (bukan .data)
        // appleSearch mengembalikan { status, data: [...], total, query }
        // Kita normalisasi ke { status, result: [...] }
        res.json({
            status: results.status,
            result: results.data || [],
            total: results.total || 0,
            query: results.query
        });

    } catch (error) {
        next(error);
    }
};
