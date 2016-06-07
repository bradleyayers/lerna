# Introducing bootstrap strategies

## Why?

I feel like the bootstrap process is not one-size-fits-all and would benefit from customization options. I ran into several issues with the current bootstrapping process and wanted to make it better, faster, stronger.

I'm not sure if the best way forward is to just modify the current bootstrap process, or allow it to be customized.

## What is this?

A way to customize the way you prepare your repository before you begin to work. Hopefully, something that makes linking everything together a seamless process that works for you.

Before I get into the details, rest assured that what you're already doing with `lerna bootstrap` is still intact. Simply bootstrap as you normally would, and everything will remain the same.

I've introduced a new flag called `strategy` which you can use to customize your bootstrapping process. Since we have 2 different types of modules, local and external, we can specify a different strategy for each type.

Let's start with external modules...

### Bootstrapping external modules

An external module is anything not in your `/packages` folder. Currently, there are 2 types of strategies for bootstrapping these: `default` and `root`. By the way, names are subject to change.

#### Default strategy

This strategy is used by the current bootstrap process. Any `dependencies`, `devDependencies`, or `peerDependencies` of your local packages are installed in their respective package folder, for each package in your `/packages` folder. This works great!

But... what if all of your packages share some of the same dependencies? What if they all share the same dependency versions? That's a lot of installing. Why not share them?

#### Root strategy

This strategy analyzes your packages and looks for dependencies that are shared amongst them. It determines the highest common denominator version for each shared package and installs that one in the root `/node_modules` folder. If you have packages that use the same dependency, but a different version, this strategy will still install that specific version in the package that depends on it.

During the bootstrapping process, you will be notified which packages depend upon, but do not share, a more common version of a dependency.

At my company, our packages all share common versions of dependencies to avoid problems in one package that may not surface in another. So, this strategy puts all of external dependencies in the root `/node_modules` folder. This has some advantages in that everything is more centralized and installation is much faster. When using this strategy, it takes ~2mins to install everything (~125 modules) as opposed to ~3.5mins with the default strategy. This also vastly improves the time it takes to "clean" up. There still some room for improvement in performance with parallelized module installs, but that will come later.

**Interesting tidbits**

I found out rather quickly that installing all external dependencies in the root `/node_modules` folder left me without the use of any modules with a binary component, such as `eslint`. Attempting to run `npm run lint` in a package folder would fail. I fixed this problem by scanning the external modules after install, and manually symlinking each binary to all local packages' `/node_modules/.bin` folders. More work needs to be done around this to factor in local packages that use different versions of external modules.

### Bootstrapping local packages

A local package is anything in your `/packages` folder. I've come up with 2 additional strategies for bootstrapping them: `copy` and `link`.

#### Default strategy

The `default` strategy is the same thing that occurs today when you run `lerna bootstrap`. Any local package that depends on another local package will be connected to that package via a bridge held up by a "dummy" module that simply exports a `require()` pointing to the required package. Are you still with me? Whew.

In most cases, this work very well. However, when you need access to other files outside of the scope of javascript and the exports of the `main` entry of `package.json`, this method becomes problematic. For instance, the modules at my company also include CSS, which I want to import into other packages. This method does not allow this and I have to resort to `npm link`, which defeats the purpose of bootstrapping.

#### Copy strategy

The intent of this strategy is to cover cases when you need to access files in a local package that won't be available with the `default` strategy. For example, let's say I have a local package that manages all of my base styles. In this case, I don't have a `main` entry in my `package.json`, but rather a `files` entry, which includes my CSS files. This strategy will allow you to copy any set of files you'd like from a local package to be available to another local package.

**Example**

```
/packages/base-styles/
├ reset.css
├ base.css
├ forms.css
├ colors.css
├ typography.css
├ variables.css
├ icons.css
├ index.css
├ layout.css
├ package.json
└ README.md
```

In this case, I'm only interested in the CSS files and would like to copy them over for each local package that needs access to them.

With this strategy, I can do the following:

```javascript
import 'base-styles/index.css';
```

**Important**

The `copy` strategy requires a `files` key to be specified in the `bootstrapConfig`. This should be done in your local package's `package.json` files, as outlined above. This is to allow a very specific set of files to be used rather than what's specified in the standard `files` key of `package.json`.

This strategy may be trumped by the next one, but it may serve someone out there.

#### Link strategy

Wait, am I not already linking my packages with the `default` strategy? Yes, yes you are, but it's not a *true* link. You're only linking the main **javascript** export of each package. As previously stated, anything else in the package is inaccessible.

This strategy symlinks your local packages to the root `node_modules` folder. This allows you to import everything available in your local packages. No need to copy anything with the `copy` strategy, just link it!

But wait, aren't there issues with symlinking packages? I thought we already determined this was a bad idea?

I'm glad you asked. Yes, there are issues with symlinked packages, NPM, and the install process. However, we can avoid these problems by installing our dependencies *first*, then symlinking our local packages after. Also, if you're not using the `root` strategy, you shouldn't run into any problems with this approach.

As with the `root` strategy, the binary files of local packages are also symlinked where appropriate.

## How do I use this?

Clone the repo

```sh
git clone https://github.com/awakenetworks/lerna.git
```

Check out the `bootstrap-strategy` branch

```sh
git checkout bootstrap-strategy
```

NPM link it

```sh
npm link
```

You should now have access to lerna globally.

**Note:** You are encouraged to [run Lerna locally](https://github.com/lerna/lerna/issues/138). But, for testing purposes, this is fine.

### Specifying a strategy

There are 3 ways to setup your bootstrap strategy.

1. Command-line flag
2. `package.json` - per package
3. `lerna.json` - globally

These strategies are listed in order of precedence, meaning one will override the other.

#### Using the command-line flag

You can specify the just the local strategy, or both local and external strategy.

**Use the `copy` strategy on local packages**

```sh
lerna bootstrap --strategy=copy
```

**Use the `link` strategy on local packages**

```sh
lerna bootstrap --strategy=link
```

**Use the `link` strategy on local packages, and the `root` strategy on external packages**

```sh
lerna bootstrap --strategy=link:root
```

**Use the `default` strategy on local packages, and the `root` strategy on external packages**

```sh
lerna bootstrap --strategy=default:root
```

**Use the `default` strategy for both**

```sh
lerna bootstrap
```

#### Using package.json

If you'd like to specify a strategy for a specific local package, you can do so in its `package.json` file under the `lerna` key.

```
{
  "name": "my-component-styles",
  "version": "0.1.0",
  "description": "Base styles for my components",
  "files": [
    "*.css",
  ],
  "dependencies": {
    ...
  },
  "devDependencies": {
    ...
  },
  "lerna": {
    "bootstrapConfig: {
      "strategy": "copy",
      "files": [
        "*.css"
      ]
    }
  }
}
```

In this case, the local package `my-component-styles` will use the copy strategy. You cannot set an external module strategy in `package.json`.

#### Using lerna.json

Specify a `strategy` in the `bootstrapConfig` of `lerna.json`.

```
{
  "lerna": "2.0.0-beta.17",
  "version": "0.0.0",
  "bootstrapConfig": {
    "strategy": "link:root"
  }
}
```

Run `lerna bootstrap`

# Is this ready to be used? What about adding X or Y?

While I use this in my environment, it's still a work in progress. Unit tests need to be written. I'm sure there's a bug somewhere and the code needs to be optimized. Please don't judge my code just yet. I wanted to have something working to validate this concept.

I would love feedback and suggestions.

If you want to chat about this, you can find me on Slack. Join the conversation @ [https://slack.lernajs.io](https://slack.lernajs.io/)