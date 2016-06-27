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
    // get glob of packages to ignore
    const ignore = this.flags.ignore || this.repository.bootstrapConfig.ignore;

    if (ignore) {
      this.logger.info(`Ignoring packages that match '${ignore}'`);
      try {
        this.bootstrapPackages = PackageUtilities.filterPackages(this.packages, ignore, true);
      } catch (err) {
        callback(err);
        return;
      }
    } else {
      this.bootstrapPackages = this.packages;
    }

    callback(null, true);
  }

  execute(callback) {
    this.linkDependencies(err => {
      if (err) {
        callback(err);
      } else {
        this.logger.success("Successfully bootstrapped " + this.packages.length + " packages.");
        callback(null, true);
      }
    });
  }

  linkDependencies(callback) {
    this.progressBar.init(this.packages.length);
    this.logger.info("Linking all dependencies");

    async.parallelLimit(this.bootstrapPackages.map(pkg => done => {
      // async actions to bootstrap each package
      const actions = [
        cb => FileSystemUtilities.mkdirp(pkg.nodeModulesLocation, cb),
        cb => this.installExternalPackages(pkg, cb),
        cb => this.linkDependenciesForPackage(pkg, cb)
      ];
      // array of dependencies with binaries
      const depsWithBin = [];
      // find matching dependencies with binaries
      this.packages.forEach(dependency => {
        // for each matched dependency with binaries
        if (this.hasMatchingDependency(pkg, dependency) && dependency.bin) {
          depsWithBin.push(dependency);
        }
      });
      // if package has dependencies with binaries
      if (depsWithBin.length) {
        // symlink binaries
        actions.push(cb => this.symlinkDependencyBinaries(pkg, depsWithBin, cb));
      }
      async.series(actions, err => {
        this.progressBar.tick(pkg.name);
        done(err);
      });
    }), this.concurrency, err => {
      this.progressBar.terminate();
      callback(err);
    });
  }

  linkDependenciesForPackage(pkg, callback) {
    async.each(this.packages, (dependency, done) => {
      if (!this.hasMatchingDependency(pkg, dependency, true)) return done();

      const linkSrc = dependency.location;
      const linkDest = path.join(pkg.nodeModulesLocation, dependency.name);

      this.createLinkedDependency(linkSrc, linkDest, dependency.name, done);
    }, callback);
  }

  createLinkedDependency(src, dest, name, callback) {
    async.series([
      cb => FileSystemUtilities.rimraf(dest, cb),
      cb => FileSystemUtilities.mkdirp(dest, cb),
      cb => this.createLinkedDependencyFiles(src, dest, name, cb)
    ], callback);
  }

  createLinkedDependencyFiles(src, dest, name, callback) {
    const srcPackageJsonLocation = path.join(src, "package.json");
    const destPackageJsonLocation = path.join(dest, "package.json");
    const destIndexJsLocation = path.join(dest, "index.js");

    const packageJsonFileContents = JSON.stringify({
      name: name,
      version: require(srcPackageJsonLocation).version
    }, null, "  ");

    const prefix = this.repository.linkedFiles.prefix || "";
    const indexJsFileContents = prefix + "module.exports = require(" + JSON.stringify(src) + ");";

    async.series([
      cb => FileSystemUtilities.writeFile(destPackageJsonLocation, packageJsonFileContents, cb),
      cb => FileSystemUtilities.writeFile(destIndexJsLocation, indexJsFileContents, cb)
    ], callback);
  }

  /**
   * Symlink package dependency binaries to the package's node_modules/.bin folder
   * @param {Package} pkg
   * @param {Array.<Package>} dependencies
   * @param {Function} callback
   */
  symlinkDependencyBinaries(pkg, dependencies, callback) {
    const actions = [];
    dependencies.forEach(dependency => {
      const { location, name, bin } = dependency;
      const destPath = path.join(pkg.nodeModulesLocation);
      actions.push(cb => this.createBinaryLink(location, destPath, name, bin, cb));
    });
    async.parallelLimit(actions, this.concurrency, callback);
  }

  /**
   * Create a symlink to a dependency's binary in the node_modules/.bin folder
   * @param {String} src Source location of package to link
   * @param {String} dest Destination node_modules folder
   * @param {String} name Name of source package
   * @param {String|Object} bin Source package.json "bin" value
   * @param {Function} callback
   */
  createBinaryLink(src, dest, name, bin, callback) {
    // destination folder of binaries
    const destBinFolder = path.join(dest, ".bin");
    const bins = typeof bin === "string" ? { [name]: bin } : bin;
    const srcBinFiles = Object.keys(bins).map(name => path.join(src, bins[name]));
    const destBinFiles = Object.keys(bins).map(name => path.join(destBinFolder, name));
    // ensure destination folder
    const actions = [cb => FileSystemUtilities.mkdirp(destBinFolder, cb)];
    // create symlinks for binaries
    srcBinFiles.forEach((binFile, idx) => {
      actions.push(cb => FileSystemUtilities.symlink(binFile, destBinFiles[idx], cb));
    });
    async.series(actions, callback);
  }

  installExternalPackages(pkg, callback) {
    const allDependencies = pkg.allDependencies;

    const externalPackages = Object.keys(allDependencies)
      .filter(dependency => {
        const match = find(this.packages, pkg => {
          return pkg.name === dependency;
        });

        return !(match && this.hasMatchingDependency(pkg, match));
      })
      .filter(dependency => {
        return !this.hasDependencyInstalled(pkg, dependency);
      })
      .map(dependency => {
        return dependency + "@" + allDependencies[dependency];
      });

    if (externalPackages.length) {
      NpmUtilities.installInDir(pkg.location, externalPackages, callback);
    } else {
      callback();
    }
  }

  hasMatchingDependency(pkg, dependency, showWarning = false) {
    const expectedVersion = pkg.allDependencies[dependency.name];
    const actualVersion = dependency.version;

    if (!expectedVersion) {
      return false;
    }

    if (this.isCompatableVersion(actualVersion, expectedVersion)) {
      return true;
    }

    if (showWarning) {
      this.logger.warning(
        `Version mismatch inside "${pkg.name}". ` +
        `Depends on "${dependency.name}@${expectedVersion}" ` +
        `instead of "${dependency.name}@${actualVersion}".`
      );
    }

    return false;
  }

  hasDependencyInstalled(pkg, dependency) {
    const packageJson = path.join(pkg.nodeModulesLocation, dependency, "package.json");
    try {
      return this.isCompatableVersion(
        require(packageJson).version,
        pkg.allDependencies[dependency]
      );
    } catch (e) {
      return false;
    }
  }

  isCompatableVersion(actual, expected) {
    return semver.satisfies(actual, expected);
  }
}
