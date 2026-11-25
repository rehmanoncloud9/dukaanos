const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const sharedLibRoot = path.resolve(projectRoot, "../src/lib");
const mobileNodeModules = path.resolve(projectRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedLibRoot];
config.resolver.nodeModulesPaths = [mobileNodeModules];
config.resolver.extraNodeModules = {
  "@noble/ed25519": path.resolve(mobileNodeModules, "@noble/ed25519"),
  "@noble/hashes": path.resolve(mobileNodeModules, "@noble/hashes"),
  zod: path.resolve(mobileNodeModules, "zod"),
};

const ALIAS_PREFIXES = [
  ["@domain/", path.resolve(sharedLibRoot, "domain") + path.sep],
  ["@/lib/domain/", path.resolve(sharedLibRoot, "domain") + path.sep],
  ["@/assets/", path.resolve(projectRoot, "assets") + path.sep],
  ["@/", path.resolve(projectRoot, "src") + path.sep],
];

const EXACT_ALIASES = {
  "@contracts": path.resolve(sharedLibRoot, "api/contracts.ts"),
  "@passport": path.resolve(sharedLibRoot, "crypto/passport.ts"),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (EXACT_ALIASES[moduleName]) {
    const target = EXACT_ALIASES[moduleName];
    return defaultResolveRequest
      ? defaultResolveRequest(context, target, platform)
      : context.resolveRequest(context, target, platform);
  }
  for (const [prefix, targetBase] of ALIAS_PREFIXES) {
    if (moduleName.startsWith(prefix)) {
      const target = targetBase + moduleName.slice(prefix.length);
      return defaultResolveRequest
        ? defaultResolveRequest(context, target, platform)
        : context.resolveRequest(context, target, platform);
    }
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

config.transformer = {
  ...config.transformer,
  minifierConfig: {
    ...config.transformer?.minifierConfig,
    compress: {
      ...config.transformer?.minifierConfig?.compress,
      drop_console: true,
    },
  },
};

module.exports = config;
