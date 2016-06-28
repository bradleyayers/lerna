import pathExists from "path-exists";
import assert from "assert";
import path from "path";
import fs from "fs";

import ChildProcessUtilities from "../src/ChildProcessUtilities";
import BootstrapCommand from "../src/commands/BootstrapCommand";
import exitWithCode from "./_exitWithCode";
import initFixture from "./_initFixture";
import stub from "./_stub";

import assertStubbedCalls from "./_assertStubbedCalls";

describe("BootstrapCommand", () => {

  describe("dependencies between packages in the repo", () => {
    let testDir;

    beforeEach(done => {
      testDir = initFixture("BootstrapCommand/basic", done);
    });

    it("should bootstrap packages", done => {
      const bootstrapCommand = new BootstrapCommand([], {});

      bootstrapCommand.runValidations();
      bootstrapCommand.runPreparations();

      const depsToInstall = bootstrapCommand.getDependenciesToInstall(bootstrapCommand.getPackages());

      assert.deepEqual(depsToInstall, {
        __ROOT__: ["foo@^1.0.0"],
        "package-3": ["foo@0.1.12"],
        "package-4": ["package-1@^0.0.0"]
      });

      assertStubbedCalls([
        [ChildProcessUtilities, "spawn", { nodeCallback: true }, [
          { args: ["npm", ["install", "foo@^1.0.0"], { cwd: testDir, stdio: "ignore" }] }
        ]],
        [ChildProcessUtilities, "spawn", { nodeCallback: true }, [
          { args: ["npm", ["install", "foo@0.1.12"], { cwd: path.join(testDir, "packages/package-3"), stdio: "ignore" }] }
        ]],
        [ChildProcessUtilities, "spawn", { nodeCallback: true }, [
          { args: ["npm", ["install", "package-1@^0.0.0"], { cwd: path.join(testDir, "packages/package-4"), stdio: "ignore" }] }
        ]]
      ]);

      bootstrapCommand.runCommand(exitWithCode(0, err => {
        if (err) return done(err);

        try {
          assert.ok(!pathExists.sync(path.join(testDir, "lerna-debug.log")), "lerna-debug.log should not exist");
          assert.equal(
            fs.readlinkSync(path.join(testDir, "node_modules", "package-1")),
            path.join(testDir, "packages/package-1"),
            "package-1 should be symlinked"
          );
          assert.equal(
            fs.readlinkSync(path.join(testDir, "node_modules", "package-2")),
            path.join(testDir, "packages/package-2"),
            "package-2 should be symlinked"
          );
          assert.equal(
            fs.readlinkSync(path.join(testDir, "node_modules", "package-3")),
            path.join(testDir, "packages/package-3"),
            "package-3 should be symlinked"
          );
          assert.equal(
            fs.readlinkSync(path.join(testDir, "node_modules", "package-4")),
            path.join(testDir, "packages/package-4"),
            "package-4 should be symlinked"
          );
          done();
        } catch (err) {
          done(err);
        }
      }));
    });

    it("should not bootstrap ignored packages", done => {
      const bootstrapCommand = new BootstrapCommand([], {
        ignore: "package-@(3|4)"
      });

      bootstrapCommand.runValidations();
      bootstrapCommand.runPreparations();

      assertStubbedCalls([
        [ChildProcessUtilities, "spawn", { nodeCallback: true }, [
          { args: ["npm", ["install", "foo@^1.0.0"], { cwd: testDir, stdio: "ignore" }] }
        ]]
      ]);

      bootstrapCommand.runCommand(exitWithCode(0, err => {
        if (err) return done(err);

        try {
          assert.ok(!pathExists.sync(path.join(testDir, "lerna-debug.log")), "lerna-debug.log should not exist");
          assert.equal(
            fs.readlinkSync(path.join(testDir, "node_modules", "package-1")),
            path.join(testDir, "packages/package-1"),
            "package-1 should be symlinked"
          );
          assert.equal(
            fs.readlinkSync(path.join(testDir, "node_modules", "package-2")),
            path.join(testDir, "packages/package-2"),
            "package-2 should be symlinked"
          );
          assert.throws(() => fs.readlinkSync(path.join(testDir, "node_modules", "package-3")));
          assert.throws(() => fs.readlinkSync(path.join(testDir, "node_modules", "package-4")));
          done();
        } catch (err) {
          done(err);
        }
      }));
    });
  });

  describe("external dependencies that haven't been installed", () => {
    let testDir;

    beforeEach(done => {
      testDir = initFixture("BootstrapCommand/cold", done);
    });

    it("should get installed", done => {
      const bootstrapCommand = new BootstrapCommand([], {});

      bootstrapCommand.runValidations();
      bootstrapCommand.runPreparations();

      let installed = 0;
      let spawnArgs = [];
      let spawnOptions = [];

      stub(ChildProcessUtilities, "spawn", (command, args, options, callback) => {
        spawnArgs.push(args);
        spawnOptions.push(options);
        installed++;
        callback();
      });

      bootstrapCommand.runCommand(exitWithCode(0, err => {
        if (err) return done(err);

        try {
          assert.ok(!pathExists.sync(path.join(testDir, "lerna-debug.log")), "lerna-debug.log should not exist");
          assert.deepEqual(spawnArgs, [
            ["install", "external@^2.0.0"],
            ["install", "external@^1.0.0"]
          ]);
          assert.deepEqual(spawnOptions, [
            { cwd: testDir, stdio: "ignore" },
            { cwd: path.join(testDir, "packages/package-1"), stdio: "ignore" }
          ]);
          assert.equal(installed, 2, "The external dependencies were installed");

          done();
        } catch (err) {
          done(err);
        }
      }));
    });
  });

  describe("external dependencies that have already been installed", () => {
    let testDir;

    beforeEach(done => {
      testDir = initFixture("BootstrapCommand/warm", done);
    });

    it("should not get re-installed", done => {
      const bootstrapCommand = new BootstrapCommand([], {});

      bootstrapCommand.runValidations();
      bootstrapCommand.runPreparations();

      let installed = false;
      stub(ChildProcessUtilities, "spawn", (command, args, options, callback) => {
        installed = true;
        callback();
      });

      bootstrapCommand.runCommand(exitWithCode(0, err => {
        if (err) return done(err);

        try {
          assert.ok(!pathExists.sync(path.join(testDir, "lerna-debug.log")), "lerna-debug.log should not exist");
          assert.ok(!installed, "The external dependency was not installed");

          done();
        } catch (err) {
          done(err);
        }
      }));
    });
  });

  describe("dependency binaries", () => {
    let testDir;

    beforeEach(done => {
      testDir = initFixture("BootstrapCommand/bin", done);
    });

    it("should be linked in root and packages", done => {
      const bootstrapCommand = new BootstrapCommand([], {});

      bootstrapCommand.runValidations();
      bootstrapCommand.runPreparations();

      assertStubbedCalls([
        [ChildProcessUtilities, "spawn", { nodeCallback: true }, [
          { args: ["npm", ["install", "external@^1.0.0"], { cwd: path.join(testDir, "packages/package-1"), stdio: "ignore" }] }
        ]]
      ]);

      bootstrapCommand.runCommand(exitWithCode(0, err => {
        if (err) return done(err);

        try {
          assert.ok(!pathExists.sync(path.join(testDir, "lerna-debug.log")), "lerna-debug.log should not exist");
          assert.equal(
            fs.readlinkSync(path.join(testDir, "node_modules/.bin", "foo")),
            path.join(testDir, "packages/package-2/foo.js"),
            "foo binary from package-2 should be symlinked at the root"
          );
          assert.equal(
            fs.readlinkSync(path.join(testDir, "node_modules/.bin", "bar")),
            path.join(testDir, "packages/package-2/bar.js"),
            "bar binary from package-2 should be symlinked at the root"
          );
          assert.equal(
            fs.readlinkSync(path.join(testDir, "packages/package-3/node_modules/.bin/foo")),
            path.join(testDir, "packages/package-2/foo.js"),
            "foo binary package-2 should be symlinked in package-3"
          );
          assert.equal(
            fs.readlinkSync(path.join(testDir, "packages/package-3/node_modules/.bin/bar")),
            path.join(testDir, "packages/package-2/bar.js"),
            "bar binary package-2 should be symlinked in package-3"
          );
          done();
        } catch (err) {
          done(err);
        }
      }));
    });
  });
});
