/**
 * Mirror configurations for package managers.
 * Provides mirror URLs and argument generation for each tool.
 */

/**
 * Package manager tool types that support mirror switching
 */
export type PackageManagerTool = "pip" | "conda" | "uv" | "pixi";

/**
 * Mirror configuration for a package manager
 */
export interface MirrorConfig {
  /** Service type for mirror lookup */
  service: "pypi" | "conda";
  /** Generate command-line arguments for using a mirror */
  getMirrorArgs: (mirrorUrl: string) => string[];
}

/**
 * Extract hostname from URL for --trusted-host
 */
function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Mirror configurations per tool
 */
export const MIRROR_CONFIGS: Record<PackageManagerTool, MirrorConfig> = {
  pip: {
    service: "pypi",
    getMirrorArgs: (url) => [
      "-i",
      url,
      "--trusted-host",
      getHostname(url),
    ],
  },

  uv: {
    service: "pypi",
    getMirrorArgs: (url) => ["--index-url", url],
  },

  conda: {
    service: "conda",
    // conda uses -c to specify channel, --override-channels to ignore defaults
    getMirrorArgs: (url) => ["-c", url, "--override-channels"],
  },

  pixi: {
    service: "conda",
    // pixi inherits conda's channel concept
    getMirrorArgs: (url) => ["--channel", url],
  },
};

/**
 * Get mirror config for a tool
 */
export function getMirrorConfig(tool: PackageManagerTool): MirrorConfig {
  return MIRROR_CONFIGS[tool];
}
