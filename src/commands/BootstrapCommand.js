import FileSystemUtilities from "../FileSystemUtilities";
import NpmUtilities from "../NpmUtilities";
import PackageUtilities from "../PackageUtilities";
import Command from "../Command";
import semver from "semver";
import async from "async";
import find from "lodash.find";
import path from "path";

export default class BootstrapCommand extends Command {
  initialize(callback) {
    // Nothing to do...
    callback(null, true);
  }

  execute(callback) {
    this.bootstrapPackages(err => {
      if (err) {
        callback(err);
      } else {
        this.logger.success(`Successfully bootstrapped ${this.packages.length} packages.`);
        callback(null, true);
      }
    });
  }

  /**
   * Return packages that satisfy the dependency requirements of the passed package
   * @param {Package} pkg The package from which to check dependencies
   * @returns {Array.<Package>}
   */
  getMatchedDependencies(pkg) {
    return this.packages.filter(dependency => pkg.hasMatchingDependency(dependency, true));
  }

  /**
   * Bootstrap packages
   * @param {Function} callback
   */
  bootstrapPackages(callback) {
    this.packages = this.getPackages();
    this.logger.info(`Bootstrapping ${this.packages.length} packages`);
    async.series(this.getBootstrapActions(), callback);
  }

  getPackages() {
    const ignore = this.flags.ignore || this.repository.bootstrapConfig.ignore;
    if (ignore) {
      this.logger.info(`Ignoring packages that match '${ignore}'`);
    }
    return PackageUtilities.filterPackages(this.packages, ignore, ignore ? true : false);
  }

  /**
   * Returns an array of async actions to execute during bootstrap
   * @returns {Array}
   */
  getBootstrapActions() {
    // async actions to perform during bootstrap
    const actions = [];
    const packagesWithBins = [];
    // for each package to bootstrap
    this.packages.forEach(pkg => {
      // array of dependencies with binaries
      const depsWithBin = [];
      // for each matched dependency
      this.getMatchedDependencies(pkg).forEach(dependency => {
        if (dependency.bin) {
          depsWithBin.push(dependency);
        }
      });
      // if package has dependencies with binaries
      if (depsWithBin.length) {
        packagesWithBins.push([pkg, depsWithBin]);
      }
    });
    // symlink dependency binaries for all packages
    actions.push(cb => this.symlinkPackageBinaries(packagesWithBins, cb))
    const depsToInstall = this.getDependenciesToInstall(this.packages);
    // install external dependencies (do this first)
    actions.unshift(cb => this.installExternalDependencies(depsToInstall, cb));
    // if installing dependencies at the root
    if (depsToInstall.__ROOT__.length) {
      // get dependenciy names
      const dependencies = depsToInstall.__ROOT__.map(name => name.split("@")[0]);
      // symlink binaries to each package
      actions.push(cb => this.symlinkDependencyBinaries(dependencies, cb));
    }
    // symlink packages at the root
    actions.push(cb => this.symlinkPackages(cb));
    return actions;
  }

  /**
   * Symlink package dependency binaries to the package's node_modules/.bin folder
   * @param {Array} packages
   * @param {Function} callback
   */
  symlinkPackageBinaries(packages, callback) {
    const actions = [];
    this.logger.info("Symlinking binaries for packages");
    packages.forEach(pkgWithBin => {
      const [pkg, dependencies] = pkgWithBin;
      dependencies.forEach(dependency => {
        const { location, name } = dependency;
        const destPath = path.join(pkg.nodeModulesLocation);
        actions.push(cb => this.createBinaryLink(location, destPath, name, dependency.bin, cb));
      });
    });
    async.parallelLimit(actions, this.concurrency, callback);
  }

  /**
   * Create a symlink to a dependency's binary in the node_modules/.bin folder
   * @param {String} src
   * @param {String} dest
   * @param {String} name
   * @param {String|Object} bin
   * @param {Function} callback
   */
  createBinaryLink(src, dest, name, bin, callback) {
    const destBinFolder = path.join(dest, ".bin");
    const bins = typeof bin === "string" ?
      { [name]: bin } :
      bin;
    const srcBinFiles = Object.keys(bins).map(name => path.join(src, bins[name]));
    const destBinFiles = Object.keys(bins).map(name => path.join(destBinFolder, name));
    const actions = [cb => FileSystemUtilities.mkdirp(destBinFolder, cb)];
    srcBinFiles.forEach((binFile, idx) => {
      actions.push(cb => FileSystemUtilities.symlink(binFile, destBinFiles[idx], cb));
    });
    async.series(actions, callback);
  }

  /**
   * Given an array of packages, return map of dependencies to install
   * @param {Array.<Package>} packages An array of packages
   * @returns {Object}
   */
  getDependenciesToInstall(packages = []) {
    // find package by name
    const findPackage = (name, version) => find(this.packages, pkg => {
      return pkg.name === name && (!version || semver.satisfies(pkg.version, version));
    });
    const hasPackage = (name, version) => Boolean(findPackage(name, version));
    /**
     * Map of dependency install locations
     *   - keys represent a package name (i.e. "my-component")
     *     "__ROOT__" is a special value and refers to the root folder
     *   - values are an array of strings representing the dependency and its version to install
     *     (i.e. ["react@15.x", "react-dom@^15.0.0", "webpack@~1.13.0"]
     *
     * {
     *   <package>: [<dependency1@version>, <dependency2@version>, ...]
     * }
     */
    const installs = { __ROOT__: [] };
    /**
     * Map of dependencies to install
     * {
     *   <name>: {
     *     versions: {
     *       <version>: <# of dependents>
     *     },
     *     dependents: {
     *       <version>: [<dependent1>, <dependent2>, ...]
     *     }
     *   }
     * }
     *
     * Example:
     *
     * {
     *   react: {
     *     versions: {
     *       "15.x": 3,
     *       "^0.14.0": 1
     *     },
     *     dependents: {
     *       "15.x": ["my-component1", "my-component2", "my-component3"],
     *       "^0.14.0": ["my-component4"],
     *     }
     *   }
     * }
     */
    const depsToInstall = {};
    // get the map of external dependencies to install
    packages.forEach(pkg => {
      // for all package dependencies
      Object.keys(pkg.allDependencies)
        // map to package or normalized external dependency
        .map(name => findPackage(name, pkg.allDependencies[name]) || { name, version: pkg.allDependencies[name] })
        // match external and version mismatched local packages
        .filter(dep => !hasPackage(dep.name, dep.version) || !pkg.hasMatchingDependency(dep))
        .forEach(dep => {
          const { name, version } = dep;
          if (!depsToInstall[name]) {
            depsToInstall[name] = {
              versions: {},
              dependents: {}
            };
          }
          // add dependency version
          if (!depsToInstall[name].versions[version]) {
            depsToInstall[name].versions[version] = 1;
          } else {
            depsToInstall[name].versions[version]++;
          }
          // add package with required version
          if (!depsToInstall[name].dependents[version]) {
            depsToInstall[name].dependents[version] = [];
          }
          depsToInstall[name].dependents[version].push(pkg.name);
        });
    });
    // determine where each dependency will be installed
    Object.keys(depsToInstall).forEach(name => {
      const allVersions = Object.keys(depsToInstall[name].versions);
      // create an object whose keys are the number of dependents
      // with values that are the version those dependents need
      const reversedVersions = Object.keys(depsToInstall[name].versions).reduce((versions, version) => {
        versions[depsToInstall[name].versions[version]] = version;
        return versions;
      }, {});
      // get the most common version
      const max = Math.max.apply(null, Object.keys(reversedVersions).map(v => parseInt(v, 10)));
      const commonVersion = reversedVersions[max.toString()];
      // get an array of packages that depend on this external module
      const deps = depsToInstall[name].dependents[commonVersion];
      // check if the external dependency is not a package with a version mismatch,
      // and is not already installed at root
      if (!hasPackage(name) && !this.dependencySatisfiesPackages(name, deps.map(dep => findPackage(dep)))) {
        // add the common version to root install
        installs.__ROOT__.push(`${name}@${commonVersion}`);
      }
      // add less common versions to package installs
      allVersions.forEach(version => {
        // only install less common versions,
        // unless it's a version-mismatched package
        if (version !== commonVersion || hasPackage(name)) {
          depsToInstall[name].dependents[version].forEach(pkg => {
            // only install dependency if it's not already installed
            if (!findPackage(pkg).hasDependencyInstalled(name)) {
              if (!installs[pkg]) {
                installs[pkg] = [];
              }
              installs[pkg].push(`${name}@${version}`);
              this.logger.warning(
                `"${pkg}" package depends on ${name}@${version}, ` +
                `which differs from the more common ${name}@${commonVersion}.`
              );
            }
          });
        }
      });
    });
    return installs;
  }

  /**
   * Determine if a dependency installed at the root satifies the requirements of the passed packages
   * This helps to optimize the bootstrap process and skip dependencies that are already installed
   * @param {String} dependency
   * @param {Array.<String>} packages
   */
  dependencySatisfiesPackages(dependency, packages) {
    const packageJson = path.join(this.repository.rootPath, "node_modules", dependency, "package.json");
    try {
      return packages.every(pkg => {
        return semver.satisfies(
          require(packageJson).version,
          pkg.allDependencies[dependency]
        );
      });
    } catch (e) {
      return false;
    }
  }

  /**
   * Install external dependencies for packages
   * @param {Object} dependencies
   * @param {Function} callback
   */
  installExternalDependencies(dependencies, callback) {
    const actions = [];
    Object.keys(dependencies)
      .forEach(dest => {
        const destLocation = dest === "__ROOT__" ?
          this.repository.rootPath :
          path.join(this.repository.packagesLocation, dest);
        if (dependencies[dest].length) {
          actions.push(cb => NpmUtilities.installInDir(destLocation, dependencies[dest], cb));
        }
      });
    if (actions.length) {
      const totalDependencies = Object.keys(dependencies)
        .reduce((count, pkg) => dependencies[pkg].length + count, 0);
      this.logger.info(`Installing ${totalDependencies} external dependencies`);
    }
    async.parallelLimit(actions, this.concurrency, callback);
  }

  /**
   * Symlink binaries of modules installed at the root
   * @param {Array.<String>} dependencies
   * @param {Function} callback
   */
  symlinkDependencyBinaries(dependencies = [], callback) {
    const actions = [];
    let binCount = 0;
    dependencies.forEach(dependency => {
      const packageLocation = path.join(this.repository.rootPath, "node_modules", dependency);
      const packageJsonLocation = path.join(packageLocation, "package.json");
      if (!FileSystemUtilities.existsSync(packageJsonLocation)) {
        this.logger.error(`Unable to find package.json for ${dependency} dependency`);
      } else {
        const packageJson = require(packageJsonLocation);
        if (packageJson.bin) {
          binCount += typeof packageJson.bin === "string" ?
            1 :
            Object.keys(packageJson.bin).length;
          // create a binary link to this package's bin file for each local package
          this.packages.forEach(localPkg => {
            const destPath = path.join(localPkg.nodeModulesLocation);
            // skip binary link if dependency was installed locally
            if (!FileSystemUtilities.existsSync(path.join(destPath, dependency))) {
              actions.push(cb => this.createBinaryLink(packageLocation, destPath, dependency, packageJson.bin, cb));
            }
          });
        }
      }
    });
    this.logger.info(`Symlinking ${binCount} external dependency binaries`);
    async.parallelLimit(actions, this.concurrency, callback);
  }

  /**
   * Symlink packages to the root node_modules folder
   * @param {Function} callback
   */
  symlinkPackages(callback) {
    this.logger.info("Symlinking packages to root");
    const destFolder = path.join(this.repository.rootPath, "node_modules");
    const actions = [cb => FileSystemUtilities.mkdirp(destFolder, cb)];
    this.packages.forEach(pkg => {
      const srcPackageLocation = path.join(this.repository.packagesLocation, pkg.name);
      const destPackageLink = path.join(destFolder, pkg.name);
      actions.push(cb => FileSystemUtilities.symlink(srcPackageLocation, destPackageLink, cb, "dir"));
      if (pkg.bin) {
        const { location, name } = pkg;
        const destPath = path.join(this.repository.rootPath, "node_modules");
        actions.push(cb => this.createBinaryLink(location, destPath, name, pkg.bin, cb));
      }
    });
    async.parallelLimit(actions, this.concurrency, callback);
  }
}
