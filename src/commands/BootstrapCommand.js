import FileSystemUtilities from "../FileSystemUtilities";
import NpmUtilities from "../NpmUtilities";
import PackageUtilities from "../PackageUtilities";
import Command from "../Command";
import async from "async";
import find from "lodash.find";
import path from "path";
import glob from "glob";
import fs from "fs-extra";

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
        this.logger.success("Successfully bootstrapped " + this.packages.length + " packages.");
        callback(null, true);
      }
    });
  }

  /**
   * Get the bootstrap strategy for local and external packages
   * The strategy is derived from the passed config, the CLI flag, or lerna.json, whichever comes first
   * @param {Object} bootstrapConfig Bootstrap config to use when determining strategy
   * @returns {{local: string, external: string}}
   */
  getStrategy(bootstrapConfig = {}) {
    const strategy = bootstrapConfig.strategy ||
      this.flags.strategy ||
      this.repository.bootstrapConfig.strategy ||
      "default:default";
    if (typeof strategy !== "string") {
      throw new Error("Bootstrap strategy must be a string");
    }
    const [local, external = "default"] = strategy.split(":");
    const validStrategies = {
      local: ["default", "copy", "link"],
      external: ["default", "root"]
    };
    if (validStrategies.local.indexOf(local) === -1) {
      throw new Error(`Local boostrap strategy must be one of ["default", "copy", "link"], ${local} provided`);
    }
    if (validStrategies.external.indexOf(external) === -1) {
      throw new Error(`External boostrap strategy must be one of ["default", "root"], ${external} provided`);
    }
    return { local, external };
  }

  /**
   * Return local packages that satisfy the dependency requirements of the passed package
   * @param {Package} pkg The package from which to check dependencies
   * @returns {Array.<Package>}
   */
  getMatchedDependencies(pkg) {
    return this.packages.filter(dependency => pkg.hasMatchingDependency(dependency, true));
  }

  /**
   * Bootstrap all packages concurrently
   * @param {Function} callback
   */
  bootstrapPackages(callback) {
    this.progressBar.init(this.packages.length);
    this.logger.info(`Bootstrapping ${this.packages.length} packages`);
    this.linkLocalPackages = [];
    this.rootExternalPackages = [];
    const ignore = this.flags.ignore || this.repository.bootstrapConfig.ignore;
    async.parallelLimit(PackageUtilities.filterPackages(this.packages, ignore, true).map(pkg => done => {
      this.bootstrapPackage(pkg, done);
    }), this.concurrency, err => {
      this.progressBar.terminate();
      if (err) {
        callback(err);
      } else {
        const actions = [];
        if (this.rootExternalPackages.length) {
          actions.push(cb => this.installDependencies(this.rootExternalPackages, cb));
        }
        if (this.linkLocalPackages.length) {
          actions.push(cb => this.symlinkPackages(this.linkLocalPackages, cb))
        }
        if (actions.length) {
          async.series(actions, callback);
        } else {
          callback(err);
        }
      }
    });
  }

  /**
   * Bootstrap a single package
   * @param {Package} pkg The package to bootstrap
   * @param {Function} callback
   */
  bootstrapPackage(pkg, callback) {
    // async actions to perform to bootstrap this package
    const actions = [];
    // whether or not this package's node_modules folder will be used
    let useLocalNodeModules = false;
    // for each matched dependency
    this.getMatchedDependencies(pkg).forEach(dependency => {
      // get the bootstrap strategy for this dependency
      const strategy = this.getStrategy(dependency.bootstrapConfig);
      // local strategy
      switch (strategy.local) {
      case "default":
        useLocalNodeModules = true;
        actions.push(cb => this.linkLocalDependency(pkg, dependency, cb));
        break;
      case "copy": {
        // get files to copy
        const files = dependency.bootstrapConfig.files;
        if (Array.isArray(files) && files.length) {
          useLocalNodeModules = true;
          // get the paths of the dependency's files
          const dependencyFiles = files.reduce((results, value) => {
            return results.concat(glob.sync(value, { cwd: dependency.location }));
          }, []);
          actions.push(cb => this.copyDependencyFiles(pkg, dependency, dependencyFiles, cb));
        }
        break;
      }
      case "link": {
        const hasPackage = (name) => this.linkLocalPackages.some(pkg => pkg.name === name);
        // no action required, will symlink dependency later
        if (!hasPackage(dependency.name)) {
          this.linkLocalPackages.push(dependency);
        }
        // if package has a binary, we still need to create a binary link in the local node_modules folder
        if (dependency._package.bin) {
          const { location, name } = dependency;
          const destPath = path.join(pkg.nodeModulesLocation);
          actions.push(cb => this.createBinaryLink(location, destPath, name, dependency._package.bin, cb));
        }
        break;
      }
      }
    });
    // get the bootstrap strategy for this package
    const strategy = this.getStrategy(pkg.bootstrapConfig);
    // external package bootstrap strategy
    switch (strategy.external) {
    case "default":
      useLocalNodeModules = true;
      actions.push(cb => this.installExternalPackages(pkg, cb));
      break;
    case "root":
      this.rootExternalPackages.push(pkg);
      break;
    }
    // if using the package's node_modules folder, make sure it exists
    if (useLocalNodeModules) {
      actions.unshift(cb => FileSystemUtilities.mkdirp(pkg.nodeModulesLocation, cb))
    }
    // execute the actions
    async.series(actions, err => {
      this.progressBar.tick(pkg.name);
      callback(err);
    });
  }

  /**
   * Link a local dependency to the specified package
   * @param {Package} pkg The target package
   * @param {Package} dependency The source dependency
   * @param callback
   */
  linkLocalDependency(pkg, dependency, callback) {
    const linkDest = path.join(pkg.nodeModulesLocation, dependency.name);
    const actions = [
      cb => FileSystemUtilities.rimraf(linkDest, cb),
      cb => FileSystemUtilities.mkdirp(linkDest, cb),
      cb => this.createLinkedDependencyFiles(pkg, dependency, cb)
    ];
    // if package has a binary, handle it
    if (dependency._package.bin) {
      const { location, name } = dependency;
      const destPath = path.join(pkg.nodeModulesLocation);
      actions.push(cb => this.createBinaryLink(location, destPath, name, dependency._package.bin, cb));
    }
    async.series(actions, callback);
  }

  /**
   * Create the files necessary to "link" a dependency to a package
   * @param {Package} pkg The target package
   * @param {Package} dependency The source dependency
   * @param callback
   */
  createLinkedDependencyFiles(pkg, dependency, callback) {
    const linkDest = path.join(pkg.nodeModulesLocation, dependency.name);
    const linkSrc = dependency.location;
    const srcPackageJsonLocation = path.join(linkSrc, "package.json");
    const destPackageJsonLocation = path.join(linkDest, "package.json");
    const destIndexJsLocation = path.join(linkDest, "index.js");
    const packageJsonFileContents = JSON.stringify({
      name: dependency.name,
      version: require(srcPackageJsonLocation).version
    }, null, "  ");
    const prefix = this.repository.linkedFiles.prefix || "";
    const indexJsFileContents = prefix + "module.exports = require(" + JSON.stringify(dependency.location) + ");";
    async.series([
      cb => FileSystemUtilities.writeFile(destPackageJsonLocation, packageJsonFileContents, cb),
      cb => FileSystemUtilities.writeFile(destIndexJsLocation, indexJsFileContents, cb)
    ], callback);
  }

  /**
   * Create a symlink to a dependency's binary in the node_modules/.bin folder
   * @param src
   * @param dest
   * @param name
   * @param bin
   * @param callback
   */
  createBinaryLink(src, dest, name, bin, callback) {
    const destBinFolder = path.join(dest, ".bin");
    const bins = typeof bin === "string" ?
      { [name]: bin } :
      bin;
    const srcBinFiles = Object.keys(bins).map(name => path.join(src, bins[name]));
    const destBinFiles = Object.keys(bins).map(name => path.join(destBinFolder, name));
    const createLink = (src, dest, callback) => {
      fs.lstat(dest, (err) => {
        if (!err) {
          fs.unlink(dest, () => fs.symlink(src, dest, callback));
        } else {
          fs.symlink(src, dest, callback);
        }
      });
    }
    const actions = [cb => FileSystemUtilities.mkdirp(destBinFolder, cb)];
    srcBinFiles.forEach((binFile, idx) => {
      actions.push(cb => createLink(binFile, destBinFiles[idx], cb));
    });
    async.series(actions, callback);
  }

  /**
   * Copy the specified files from the source dependency to the target package's node_modules folder
   * @param {Package} pkg The target package
   * @param {Package} dependency The source dependency
   * @param {Array.<String>} files An array of file paths to copy
   * @param callback
   */
  copyDependencyFiles(pkg, dependency, files, callback) {
    const src = (file) => path.join(dependency.location, file);
    const dest = (file) => path.join(pkg.nodeModulesLocation, dependency.name, file);
    const copyFile = (file, cb) => fs.copy(src(file), dest(file), cb);
    async.eachLimit(files, 10, copyFile, callback);
  }

  /**
   * Install external packages for the specified package
   * @param {Package} pkg The target package
   * @param callback
   */
  installExternalPackages(pkg, callback) {
    const allDependencies = pkg.allDependencies;

    const externalPackages = Object.keys(allDependencies)
      .filter(dependency => {
        const match = find(this.packages, pkg => {
          return pkg.name === dependency;
        });
        return !(match && pkg.hasMatchingDependency(match));
      })
      .filter(dependency => {
        return !pkg.hasDependencyInstalled(dependency);
      })
      .map(dependency => {
        return dependency + "@" + allDependencies[dependency];
      });

    if (externalPackages.length) {
      NpmUtilities.installInDir(pkg.location, externalPackages, callback);
    } else {
      callback(null);
    }
  }

  /**
   * Symlink local packages to the root node_modules folder
   * @param {Array.<Package>} packages Packages to symlink
   * @param {Function} callback
   */
  symlinkPackages(packages = [], callback) {
    this.logger.info(`Symlinking ${packages.length} packages`);
    const destFolder = path.join(this.repository.rootPath, "node_modules");
    const actions = [cb => FileSystemUtilities.mkdirp(destFolder, cb)];
    const createLink = (src, dest, done) => {
      fs.lstat(dest, (err) => {
        if (!err) {
          fs.unlink(dest, () => fs.symlink(src, dest, done));
        } else {
          fs.symlink(src, dest, done);
        }
      });
    }
    packages.forEach(pkg => {
      const srcPackageLocation = path.join(this.repository.packagesLocation, pkg.name);
      const destPackageLink = path.join(destFolder, pkg.name);
      actions.push(cb => createLink(srcPackageLocation, destPackageLink, cb));
      if (pkg._package.bin) {
        const { location, name } = pkg;
        const destPath = path.join(this.repository.rootPath, "node_modules");
        actions.push(cb => this.createBinaryLink(location, destPath, name, pkg._package.bin, cb));
      }
    });
    async.parallelLimit(actions, this.concurrency, callback);
  }

  /**
   * Given an array of packages,
   * return a map of dependencies and all versions required
   * @param {Array.<Package>} packages An array of packages
   */
  getPackagesToInstall(packages = []) {
    const deps = packages.reduce((result, pkg) => {
      Object.keys(pkg.allDependencies).map(name => {
        let dependency;
        this.packages.some(pkg => {
          if (pkg.name === name) {
            dependency = pkg;
            return true;
          }
        });
        return dependency ? dependency : { name, version: pkg.allDependencies[name] };
      }).filter(dependency => {
        // match external and version mismatched local packages
        return this.packages.map(pkg => pkg.name).indexOf(dependency.name) === -1 ||
          !pkg.hasMatchingDependency(dependency);
      }).forEach(dependency => {
        if (!result[dependency.name]) {
          result[dependency.name] = {
            versions: {},
            dependents: {}
          };
        }
        // add dependency version
        if (!result[dependency.name].versions[dependency.version]) {
          result[dependency.name].versions[dependency.version] = 1;
        } else {
          result[dependency.name].versions[dependency.version]++;
        }
        // add package with required version
        if (!result[dependency.name].dependents[dependency.version]) {
          result[dependency.name].dependents[dependency.version] = [];
        }
        result[dependency.name].dependents[dependency.version].push(pkg.name);
      })
      return result;
    }, {});

    const installs = {
      __root__: []
    };

    Object.keys(deps).forEach(name => {
      const allVersions = Object.keys(deps[name].versions);
      // need to consider multiple deps with the same amount of versions being depended on
      const reversedVersions = Object.keys(deps[name].versions).reduce((versions, version) => {
        versions[deps[name].versions[version]] = version;
        return versions;
      }, {});
      // get the most common version
      const max = Math.max.apply(null, Object.keys(reversedVersions).map(v => parseInt(v, 10)));
      const topVersion = reversedVersions[max.toString()];
      // add the top version to root install
      installs.__root__.push(`${name}@${topVersion}`);
      // get the less common versions
      const localVersions = allVersions.filter(version => version !== topVersion);
      // add local versions to package installs
      localVersions.forEach(version => {
        deps[name].dependents[version].forEach(pkg => {
          if (!installs[pkg]) {
            installs[pkg] = [];
          }
          installs[pkg].push(`${name}@${version}`);
          this.logger.warning(
            `"${pkg}" package depends on ${name}@${version}, ` +
            `which differs from the more common ${name}@${topVersion}.`
          );
        });
      })
    });

    return installs;
  }

  /**
   * Install external dependencies for all packages
   * @param packages
   * @param callback
   */
  installDependencies(packages = [], callback) {
    const packagesToInstall = this.getPackagesToInstall(packages);
    const installs = [];
    const totalDependencies = Object.keys(packagesToInstall)
      .reduce((count, pkg) => packagesToInstall[pkg].length + count, 0);
    this.logger.info(`Installing ${totalDependencies} external dependencies`);
    this.progressBar.init(Object.keys(packagesToInstall).length);
    Object.keys(packagesToInstall).forEach(pkg => {
      const destLocation = pkg === "__root__" ?
        this.repository.rootPath :
        path.join(this.repository.packagesLocation, pkg);
      installs.push(cb => NpmUtilities.installInDir(destLocation, packagesToInstall[pkg], (err) => {
        this.progressBar.tick(pkg);
        cb(err);
      }));
    });
    async.parallelLimit(installs, this.concurrency, err => {
      this.progressBar.terminate();
      // if installing packages at the root
      if (!err && packagesToInstall.__root__.length) {
        const packages = packagesToInstall.__root__.map(name => name.split("@")[0]);
        // symlink binaries
        this.symlinkModuleBinaries(packages, callback);
      } else {
        callback(err);
      }
    });
  }

  /**
   * Symlink binaries of modules installed at the root
   * @param packages
   * @param callback
   */
  symlinkModuleBinaries(packages = [], callback) {
    const actions = [];
    let binCount = 0;
    packages.forEach(pkg => {
      const packageLocation = path.join(this.repository.rootPath, "node_modules", pkg);
      const packageJsonLocation = path.join(packageLocation, "package.json");
      const packageJson = require(packageJsonLocation);
      if (packageJson.bin) {
        binCount += typeof packageJson.bin === "string" ? 1 : Object.keys(packageJson.bin).length;
        // create a binary link to this package's bin file for each local package
        this.packages.forEach(localPkg => {
          const destPath = path.join(localPkg.nodeModulesLocation);
          actions.push(cb => this.createBinaryLink(packageLocation, destPath, pkg, packageJson.bin, cb));
        });
      }
    });
    if (binCount > 0) {
      this.logger.info(`Symlinking ${binCount} external dependency binaries`);
    }
    async.parallelLimit(actions, this.concurrency, callback);
  }
}
