const CompressionPlugin = require("compression-webpack-plugin");
const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");
const fs = require("fs");
const path = require("path");

const shouldAnalyze = process.env.ANALYZE === "true";

const getBackendDevPort = () => {
  const envPath = path.resolve(__dirname, "../backend/.env");
  if (!fs.existsSync(envPath)) return 5001;

  const portLine = fs.readFileSync(envPath, "utf8").match(/^\s*PORT\s*=\s*["']?(\d+)["']?\s*(?:#.*)?$/m);
  const port = Number(portLine?.[1] || 5001);
  return port > 0 && port <= 65535 ? port : 5001;
};

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      const isProduction = webpackConfig.mode === "production";
      if (!isProduction && process.env.DEV_LAZY_COMPILATION === "true") {
        // Local-only opt-in: the lazy compiler connects to localhost and delays first page visits.
        webpackConfig.experiments = {
          ...webpackConfig.experiments,
          lazyCompilation: { entries: false, imports: true },
        };
      }

      if (isProduction) {
        webpackConfig.optimization = {
          ...webpackConfig.optimization,
          runtimeChunk: "single",
          splitChunks: {
            chunks: "all",
            maxInitialRequests: 30,
            maxAsyncRequests: 30,
            cacheGroups: {
              pdfVendor: {
                test: /[\\/]node_modules[\\/]pdfjs-dist[\\/]/,
                name: "vendor-pdf",
                chunks: "async",
                priority: 40,
                enforce: true,
              },
              reactVendor: {
                test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/,
                name: "vendor-react",
                chunks: "all",
                priority: 30,
                enforce: true,
              },
              uiVendor: {
                test: /[\\/]node_modules[\\/](bootstrap|@popperjs)[\\/]/,
                name: "vendor-ui",
                chunks: "all",
                priority: 20,
                enforce: true,
              },
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: "vendor",
                chunks: "all",
                priority: 10,
                reuseExistingChunk: true,
              },
              common: {
                test: /[\\/]src[\\/](api|auth|components|utils)[\\/]/,
                name: "common",
                minChunks: 2,
                chunks: "all",
                priority: 5,
                reuseExistingChunk: true,
              },
            },
          },
        };

        webpackConfig.output = {
          ...webpackConfig.output,
          filename: "static/js/[name].[contenthash:8].js",
          chunkFilename: "static/js/[name].[contenthash:8].chunk.js",
        };
      }

      const environmentPlugin = webpackConfig.plugins.find(
        (plugin) => plugin?.constructor?.name === "DefinePlugin" && plugin?.definitions?.["process.env"],
      );
      if (environmentPlugin) {
        environmentPlugin.definitions["process.env"].VITE_NEW_SALES_ORDER_ENABLED = JSON.stringify(
          process.env.VITE_NEW_SALES_ORDER_ENABLED || "false",
        );
        environmentPlugin.definitions["process.env"].VITE_NEW_SALES_ORDER_ALLOW_SAP_WRITES = JSON.stringify(
          process.env.VITE_NEW_SALES_ORDER_ALLOW_SAP_WRITES || "false",
        );
      }

      if (isProduction) webpackConfig.plugins.push(
        new CompressionPlugin({
          algorithm: "gzip",
          test: /\.(js|css|html|svg)$/,
          threshold: 10240,
          minRatio: 0.8,
        }),
      );

      if (shouldAnalyze) {
        webpackConfig.plugins.push(
          new BundleAnalyzerPlugin({
            analyzerMode: "static",
            reportFilename: "bundle-report.html",
            openAnalyzer: false,
          }),
        );
      }

      return webpackConfig;
    },
  },
  devServer: (devServerConfig) => {
    // Keep browser API calls same-origin in development, using the backend's
    // configured port even when the frontend has no local .env file.
    devServerConfig.proxy = [{
      context: ["/api"],
      target: `http://127.0.0.1:${getBackendDevPort()}`,
      changeOrigin: true,
    }];

    const onBeforeSetupMiddleware = devServerConfig.onBeforeSetupMiddleware;
    const onAfterSetupMiddleware = devServerConfig.onAfterSetupMiddleware;
    const existingSetupMiddlewares = devServerConfig.setupMiddlewares;

    delete devServerConfig.onBeforeSetupMiddleware;
    delete devServerConfig.onAfterSetupMiddleware;

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      if (typeof onBeforeSetupMiddleware === "function") {
        onBeforeSetupMiddleware(devServer);
      }

      const nextMiddlewares = typeof existingSetupMiddlewares === "function"
        ? existingSetupMiddlewares(middlewares, devServer)
        : middlewares;

      if (typeof onAfterSetupMiddleware === "function") {
        onAfterSetupMiddleware(devServer);
      }

      return nextMiddlewares;
    };

    return devServerConfig;
  },
};
