/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config) => {
        config.resolve.fallback = {
            ...config.resolve.fallback,
            punycode: false,
        };
        return config;
    },

    experimental: {
        outputFileTracingRoot: require('path').join(__dirname, '../../'),
    },
};
module.exports = nextConfig;
