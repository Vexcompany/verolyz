module.exports = (err, req, res, next) => {
    console.error(`[ERROR] ${err.message}`);
    console.error(err.stack);

    // Jika error dari Axios
    if (err.response) {
        return res.status(err.response.status || 500).json({
            status: false,
            message: 'External API error',
            error: err.message
        });
    }

    res.status(500).json({
        status: false,
        message: err.message || 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};