"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = undefined;

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _FileSystemUtilities = require("../FileSystemUtilities");

var _FileSystemUtilities2 = _interopRequireDefault(_FileSystemUtilities);

var _NpmUtilities = require("../NpmUtilities");

var _NpmUtilities2 = _interopRequireDefault(_NpmUtilities);

var _PackageUtilities = require("../PackageUtilities");

var _PackageUtilities2 = _interopRequireDefault(_PackageUtilities);

var _Command2 = require("../Command");

var _Command3 = _interopRequireDefault(_Command2);

var _async = require("async");

var _async2 = _interopRequireDefault(_async);

var _lodash = require("lodash.find");

var _lodash2 = _interopRequireDefault(_lodash);

var _path = require("path");

var _path2 = _interopRequireDefault(_path);

var _glob = require("glob");

var _glob2 = _interopRequireDefault(_glob);

var _fsExtra = require("fs-extra");

var _fsExtra2 = _interopRequireDefault(_fsExtra);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var BootstrapCommand = function (_Command) {
  _inherits(BootstrapCommand, _Command);

  function BootstrapCommand() {
    _classCallCheck(this, BootstrapCommand);

    return _possibleConstructorReturn(this, Object.getPrototypeOf(BootstrapCommand).apply(this, arguments));
  }

  _createClass(BootstrapCommand, [{
    key: "initialize",
    value: function initialize(callback) {
      // Nothing to do...
      callback(null, true);
    }
  }, {
    key: "execute",
    value: function execute(callback) {
      var _this2 = this;

      this.bootstrapPackages(function (err) {
        if (err) {
          callback(err);
        } else {
          _this2.logger.success("Successfully bootstrapped " + _this2.packages.length + " packages.");
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

  }, {
    key: "getStrategy",
    value: function getStrategy() {
      var bootstrapConfig = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

      var strategy = bootstrapConfig.strategy || this.flags.strategy || this.repository.bootstrapConfig.strategy || "default:default";
      if (typeof strategy !== "string") {
        throw new Error("Bootstrap strategy must be a string");
      }

      var _strategy$split = strategy.split(":");

      var _strategy$split2 = _slicedToArray(_strategy$split, 2);

      var local = _strategy$split2[0];
      var _strategy$split2$ = _strategy$split2[1];
      var external = _strategy$split2$ === undefined ? "default" : _strategy$split2$;

      var validStrategies = {
        local: ["default", "copy", "link"],
        external: ["default", "root"]
      };
      if (validStrategies.local.indexOf(local) === -1) {
        throw new Error("Local boostrap strategy must be one of [\"default\", \"copy\", \"link\"], " + local + " provided");
      }
      if (validStrategies.external.indexOf(external) === -1) {
        throw new Error("External boostrap strategy must be one of [\"default\", \"root\"], " + external + " provided");
      }
      return { local: local, external: external };
    }

    /**
     * Return local packages that satisfy the dependency requirements of the passed package
     * @param {Package} pkg The package from which to check dependencies
     * @returns {Array.<Package>}
     */

  }, {
    key: "getMatchedDependencies",
    value: function getMatchedDependencies(pkg) {
      return this.packages.filter(function (dependency) {
        return pkg.hasMatchingDependency(dependency, true);
      });
    }

    /**
     * Bootstrap all packages concurrently
     * @param {Function} callback
     */

  }, {
    key: "bootstrapPackages",
    value: function bootstrapPackages(callback) {
      var _this3 = this;

      this.progressBar.init(this.packages.length);
      this.logger.info("Bootstrapping " + this.packages.length + " packages");
      this.linkLocalPackages = [];
      this.rootExternalPackages = [];
      var ignore = this.flags.ignore || this.repository.bootstrapConfig.ignore;
      _async2.default.parallelLimit(_PackageUtilities2.default.filterPackages(this.packages, ignore, true).map(function (pkg) {
        return function (done) {
          _this3.bootstrapPackage(pkg, done);
        };
      }), this.concurrency, function (err) {
        _this3.progressBar.terminate();
        if (err) {
          callback(err);
        } else {
          var actions = [];
          if (_this3.rootExternalPackages.length) {
            actions.push(function (cb) {
              return _this3.installDependencies(_this3.rootExternalPackages, cb);
            });
          }
          if (_this3.linkLocalPackages.length) {
            actions.push(function (cb) {
              return _this3.symlinkPackages(_this3.linkLocalPackages, cb);
            });
          }
          if (actions.length) {
            _async2.default.series(actions, callback);
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

  }, {
    key: "bootstrapPackage",
    value: function bootstrapPackage(pkg, callback) {
      var _this4 = this;

      // async actions to perform to bootstrap this package
      var actions = [];
      // whether or not this package's node_modules folder will be used
      var useLocalNodeModules = false;
      // for each matched dependency
      this.getMatchedDependencies(pkg).forEach(function (dependency) {
        // get the bootstrap strategy for this dependency
        var strategy = _this4.getStrategy(dependency.bootstrapConfig);
        // local strategy
        switch (strategy.local) {
          case "default":
            useLocalNodeModules = true;
            actions.push(function (cb) {
              return _this4.linkLocalDependency(pkg, dependency, cb);
            });
            break;
          case "copy":
            {
              // get files to copy
              var files = dependency.bootstrapConfig.files;
              if (Array.isArray(files) && files.length) {
                (function () {
                  useLocalNodeModules = true;
                  // get the paths of the dependency's files
                  var dependencyFiles = files.reduce(function (results, value) {
                    return results.concat(_glob2.default.sync(value, { cwd: dependency.location }));
                  }, []);
                  actions.push(function (cb) {
                    return _this4.copyDependencyFiles(pkg, dependency, dependencyFiles, cb);
                  });
                })();
              }
              break;
            }
          case "link":
            {
              var hasPackage = function hasPackage(name) {
                return _this4.linkLocalPackages.some(function (pkg) {
                  return pkg.name === name;
                });
              };
              // no action required, will symlink dependency later
              if (!hasPackage(dependency.name)) {
                _this4.linkLocalPackages.push(dependency);
              }
              // if package has a binary, we still need to create a binary link in the local node_modules folder
              if (dependency._package.bin) {
                (function () {
                  var location = dependency.location;
                  var name = dependency.name;

                  var destPath = _path2.default.join(pkg.nodeModulesLocation);
                  actions.push(function (cb) {
                    return _this4.createBinaryLink(location, destPath, name, dependency._package.bin, cb);
                  });
                })();
              }
              break;
            }
        }
      });
      // get the bootstrap strategy for this package
      var strategy = this.getStrategy(pkg.bootstrapConfig);
      // external package bootstrap strategy
      switch (strategy.external) {
        case "default":
          useLocalNodeModules = true;
          actions.push(function (cb) {
            return _this4.installExternalPackages(pkg, cb);
          });
          break;
        case "root":
          this.rootExternalPackages.push(pkg);
          break;
      }
      // if using the package's node_modules folder, make sure it exists
      if (useLocalNodeModules) {
        actions.unshift(function (cb) {
          return _FileSystemUtilities2.default.mkdirp(pkg.nodeModulesLocation, cb);
        });
      }
      // execute the actions
      _async2.default.series(actions, function (err) {
        _this4.progressBar.tick(pkg.name);
        callback(err);
      });
    }

    /**
     * Link a local dependency to the specified package
     * @param {Package} pkg The target package
     * @param {Package} dependency The source dependency
     * @param callback
     */

  }, {
    key: "linkLocalDependency",
    value: function linkLocalDependency(pkg, dependency, callback) {
      var _this5 = this;

      var linkDest = _path2.default.join(pkg.nodeModulesLocation, dependency.name);
      var actions = [function (cb) {
        return _FileSystemUtilities2.default.rimraf(linkDest, cb);
      }, function (cb) {
        return _FileSystemUtilities2.default.mkdirp(linkDest, cb);
      }, function (cb) {
        return _this5.createLinkedDependencyFiles(pkg, dependency, cb);
      }];
      // if package has a binary, handle it
      if (dependency._package.bin) {
        (function () {
          var location = dependency.location;
          var name = dependency.name;

          var destPath = _path2.default.join(pkg.nodeModulesLocation);
          actions.push(function (cb) {
            return _this5.createBinaryLink(location, destPath, name, dependency._package.bin, cb);
          });
        })();
      }
      _async2.default.series(actions, callback);
    }

    /**
     * Create the files necessary to "link" a dependency to a package
     * @param {Package} pkg The target package
     * @param {Package} dependency The source dependency
     * @param callback
     */

  }, {
    key: "createLinkedDependencyFiles",
    value: function createLinkedDependencyFiles(pkg, dependency, callback) {
      var linkDest = _path2.default.join(pkg.nodeModulesLocation, dependency.name);
      var linkSrc = dependency.location;
      var srcPackageJsonLocation = _path2.default.join(linkSrc, "package.json");
      var destPackageJsonLocation = _path2.default.join(linkDest, "package.json");
      var destIndexJsLocation = _path2.default.join(linkDest, "index.js");
      var packageJsonFileContents = JSON.stringify({
        name: dependency.name,
        version: require(srcPackageJsonLocation).version
      }, null, "  ");
      var prefix = this.repository.linkedFiles.prefix || "";
      var indexJsFileContents = prefix + "module.exports = require(" + JSON.stringify(dependency.location) + ");";
      _async2.default.series([function (cb) {
        return _FileSystemUtilities2.default.writeFile(destPackageJsonLocation, packageJsonFileContents, cb);
      }, function (cb) {
        return _FileSystemUtilities2.default.writeFile(destIndexJsLocation, indexJsFileContents, cb);
      }], callback);
    }

    /**
     * Create a symlink to a dependency's binary in the node_modules/.bin folder
     * @param src
     * @param dest
     * @param name
     * @param bin
     * @param callback
     */

  }, {
    key: "createBinaryLink",
    value: function createBinaryLink(src, dest, name, bin, callback) {
      var destBinFolder = _path2.default.join(dest, ".bin");
      var bins = typeof bin === "string" ? _defineProperty({}, name, bin) : bin;
      var srcBinFiles = Object.keys(bins).map(function (name) {
        return _path2.default.join(src, bins[name]);
      });
      var destBinFiles = Object.keys(bins).map(function (name) {
        return _path2.default.join(destBinFolder, name);
      });
      var createLink = function createLink(src, dest, callback) {
        _fsExtra2.default.lstat(dest, function (err) {
          if (!err) {
            _fsExtra2.default.unlink(dest, function () {
              return _fsExtra2.default.symlink(src, dest, callback);
            });
          } else {
            _fsExtra2.default.symlink(src, dest, callback);
          }
        });
      };
      var actions = [function (cb) {
        return _FileSystemUtilities2.default.mkdirp(destBinFolder, cb);
      }];
      srcBinFiles.forEach(function (binFile, idx) {
        actions.push(function (cb) {
          return createLink(binFile, destBinFiles[idx], cb);
        });
      });
      _async2.default.series(actions, callback);
    }

    /**
     * Copy the specified files from the source dependency to the target package's node_modules folder
     * @param {Package} pkg The target package
     * @param {Package} dependency The source dependency
     * @param {Array.<String>} files An array of file paths to copy
     * @param callback
     */

  }, {
    key: "copyDependencyFiles",
    value: function copyDependencyFiles(pkg, dependency, files, callback) {
      var src = function src(file) {
        return _path2.default.join(dependency.location, file);
      };
      var dest = function dest(file) {
        return _path2.default.join(pkg.nodeModulesLocation, dependency.name, file);
      };
      var copyFile = function copyFile(file, cb) {
        return _fsExtra2.default.copy(src(file), dest(file), cb);
      };
      _async2.default.eachLimit(files, 10, copyFile, callback);
    }

    /**
     * Install external packages for the specified package
     * @param {Package} pkg The target package
     * @param callback
     */

  }, {
    key: "installExternalPackages",
    value: function installExternalPackages(pkg, callback) {
      var _this6 = this;

      var allDependencies = pkg.allDependencies;

      var externalPackages = Object.keys(allDependencies).filter(function (dependency) {
        var match = (0, _lodash2.default)(_this6.packages, function (pkg) {
          return pkg.name === dependency;
        });
        return !(match && pkg.hasMatchingDependency(match));
      }).filter(function (dependency) {
        return !pkg.hasDependencyInstalled(dependency);
      }).map(function (dependency) {
        return dependency + "@" + allDependencies[dependency];
      });

      if (externalPackages.length) {
        _NpmUtilities2.default.installInDir(pkg.location, externalPackages, callback);
      } else {
        callback(null);
      }
    }

    /**
     * Symlink local packages to the root node_modules folder
     * @param {Array.<Package>} packages Packages to symlink
     * @param {Function} callback
     */

  }, {
    key: "symlinkPackages",
    value: function symlinkPackages() {
      var _this7 = this;

      var packages = arguments.length <= 0 || arguments[0] === undefined ? [] : arguments[0];
      var callback = arguments[1];

      this.logger.info("Symlinking " + packages.length + " packages");
      var destFolder = _path2.default.join(this.repository.rootPath, "node_modules");
      var actions = [function (cb) {
        return _FileSystemUtilities2.default.mkdirp(destFolder, cb);
      }];
      var createLink = function createLink(src, dest, done) {
        _fsExtra2.default.lstat(dest, function (err) {
          if (!err) {
            _fsExtra2.default.unlink(dest, function () {
              return _fsExtra2.default.symlink(src, dest, done);
            });
          } else {
            _fsExtra2.default.symlink(src, dest, done);
          }
        });
      };
      packages.forEach(function (pkg) {
        var srcPackageLocation = _path2.default.join(_this7.repository.packagesLocation, pkg.name);
        var destPackageLink = _path2.default.join(destFolder, pkg.name);
        actions.push(function (cb) {
          return createLink(srcPackageLocation, destPackageLink, cb);
        });
        if (pkg._package.bin) {
          (function () {
            var location = pkg.location;
            var name = pkg.name;

            var destPath = _path2.default.join(_this7.repository.rootPath, "node_modules");
            actions.push(function (cb) {
              return _this7.createBinaryLink(location, destPath, name, pkg._package.bin, cb);
            });
          })();
        }
      });
      _async2.default.parallelLimit(actions, this.concurrency, callback);
    }

    /**
     * Given an array of packages,
     * return a map of dependencies and all versions required
     * @param {Array.<Package>} packages An array of packages
     */

  }, {
    key: "getPackagesToInstall",
    value: function getPackagesToInstall() {
      var _this8 = this;

      var packages = arguments.length <= 0 || arguments[0] === undefined ? [] : arguments[0];

      var deps = packages.reduce(function (result, pkg) {
        Object.keys(pkg.allDependencies).map(function (name) {
          var dependency = void 0;
          _this8.packages.some(function (pkg) {
            if (pkg.name === name) {
              dependency = pkg;
              return true;
            }
          });
          return dependency ? dependency : { name: name, version: pkg.allDependencies[name] };
        }).filter(function (dependency) {
          // match external and version mismatched local packages
          return _this8.packages.map(function (pkg) {
            return pkg.name;
          }).indexOf(dependency.name) === -1 || !pkg.hasMatchingDependency(dependency);
        }).forEach(function (dependency) {
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
        });
        return result;
      }, {});

      var installs = {
        __root__: []
      };

      Object.keys(deps).forEach(function (name) {
        var allVersions = Object.keys(deps[name].versions);
        // need to consider multiple deps with the same amount of versions being depended on
        var reversedVersions = Object.keys(deps[name].versions).reduce(function (versions, version) {
          versions[deps[name].versions[version]] = version;
          return versions;
        }, {});
        // get the most common version
        var max = Math.max.apply(null, Object.keys(reversedVersions).map(function (v) {
          return parseInt(v, 10);
        }));
        var topVersion = reversedVersions[max.toString()];
        // add the top version to root install
        installs.__root__.push(name + "@" + topVersion);
        // get the less common versions
        var localVersions = allVersions.filter(function (version) {
          return version !== topVersion;
        });
        // add local versions to package installs
        localVersions.forEach(function (version) {
          deps[name].dependents[version].forEach(function (pkg) {
            if (!installs[pkg]) {
              installs[pkg] = [];
            }
            installs[pkg].push(name + "@" + version);
            _this8.logger.warning("\"" + pkg + "\" package depends on " + name + "@" + version + ", " + ("which differs from the more common " + name + "@" + topVersion + "."));
          });
        });
      });

      return installs;
    }

    /**
     * Install external dependencies for all packages
     * @param packages
     * @param callback
     */

  }, {
    key: "installDependencies",
    value: function installDependencies() {
      var _this9 = this;

      var packages = arguments.length <= 0 || arguments[0] === undefined ? [] : arguments[0];
      var callback = arguments[1];

      var packagesToInstall = this.getPackagesToInstall(packages);
      var installs = [];
      var totalDependencies = Object.keys(packagesToInstall).reduce(function (count, pkg) {
        return packagesToInstall[pkg].length + count;
      }, 0);
      this.logger.info("Installing " + totalDependencies + " external dependencies");
      this.progressBar.init(Object.keys(packagesToInstall).length);
      Object.keys(packagesToInstall).forEach(function (pkg) {
        var destLocation = pkg === "__root__" ? _this9.repository.rootPath : _path2.default.join(_this9.repository.packagesLocation, pkg);
        installs.push(function (cb) {
          return _NpmUtilities2.default.installInDir(destLocation, packagesToInstall[pkg], function (err) {
            _this9.progressBar.tick(pkg);
            cb(err);
          });
        });
      });
      _async2.default.parallelLimit(installs, this.concurrency, function (err) {
        _this9.progressBar.terminate();
        // if installing packages at the root
        if (!err && packagesToInstall.__root__.length) {
          var _packages = packagesToInstall.__root__.map(function (name) {
            return name.split("@")[0];
          });
          // symlink binaries
          _this9.symlinkModuleBinaries(_packages, callback);
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

  }, {
    key: "symlinkModuleBinaries",
    value: function symlinkModuleBinaries() {
      var _this10 = this;

      var packages = arguments.length <= 0 || arguments[0] === undefined ? [] : arguments[0];
      var callback = arguments[1];

      var actions = [];
      var binCount = 0;
      packages.forEach(function (pkg) {
        var packageLocation = _path2.default.join(_this10.repository.rootPath, "node_modules", pkg);
        var packageJsonLocation = _path2.default.join(packageLocation, "package.json");
        var packageJson = require(packageJsonLocation);
        if (packageJson.bin) {
          binCount += typeof packageJson.bin === "string" ? 1 : Object.keys(packageJson.bin).length;
          // create a binary link to this package's bin file for each local package
          _this10.packages.forEach(function (localPkg) {
            var destPath = _path2.default.join(localPkg.nodeModulesLocation);
            actions.push(function (cb) {
              return _this10.createBinaryLink(packageLocation, destPath, pkg, packageJson.bin, cb);
            });
          });
        }
      });
      if (binCount > 0) {
        this.logger.info("Symlinking " + binCount + " external dependency binaries");
      }
      _async2.default.parallelLimit(actions, this.concurrency, callback);
    }
  }]);

  return BootstrapCommand;
}(_Command3.default);

exports.default = BootstrapCommand;
module.exports = exports["default"];