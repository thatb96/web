import fs from 'fs';
import path from 'path';
import rimraf from 'rimraf';
import chalk from 'chalk';
import ora from 'ora';
import yargs from 'yargs-parser';
import isBuiltin from 'is-builtin-module';

import * as rollup from 'rollup';
import rollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import rollupPluginCommonjs from 'rollup-plugin-commonjs';
import rollupPluginNodeBuiltins from '@joseph184/rollup-plugin-node-builtins';
import rollupPluginNodeGlobals from 'rollup-plugin-node-globals';

const cwd = process.cwd();
let spinner = ora(chalk.bold(`@pika/web`) + ` installing...`);

function showHelp() {
  console.log(`${chalk.bold(`@pika/web`)} - Install npm dependencies to run natively on the web.`);
  console.log(`
  Options
    --strict    Require a pure ESM dependency tree (will fail on any Common.js file).
    --builtins  Polyfill & shim Node.js builtin modules (ex: "path", "fs", etc.)
`);
}

function logError(msg) {
  spinner.stopAndPersist({symbol: chalk.cyan('⠼')});
  spinner = ora(chalk.red(msg));
  spinner.fail();
}

function transformWebModuleFilename(depName:string):string {
  return depName.replace('/', '--');
}

export async function install(arrayOfDeps: string[], {isWhitelist, supportsCJS, supportNodeBuiltins}: {isWhitelist: boolean, supportsCJS?: boolean, supportNodeBuiltins?: boolean}) {
  if (arrayOfDeps.length === 0) {
    logError('no dependencies found.');
    return;
  }
  if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
    logError('no node_modules/ directory exists. Run "npm install" in your project before running @pika/web.');
    return;
  }

  rimraf.sync(path.join(cwd, 'web_modules'));

  const depObject = {};
  for (const dep of arrayOfDeps) {
    const depLoc = path.join(cwd, 'node_modules', dep);
    if (!fs.existsSync(depLoc)) {
        logError(`dependency "${dep}" not found in your node_modules/ directory. Did you run npm install?`);
      return;
    }
    const depManifestLoc = path.join(cwd, 'node_modules', dep, 'package.json');
    const depManifest = require(depManifestLoc);
    if (!depManifest.module) {
      if (isWhitelist) {
        logError(`dependency "${dep}" has no ES "module" entrypoint.`);
        console.log('\n' + chalk.italic(`Tip: Find modern, web-ready packages at ${chalk.underline('https://pikapkg.com/packages')}`) + '\n');
        return false;
      }
      continue;
    }
    depObject[transformWebModuleFilename(dep)] = path.join(depLoc, depManifest.module);
  }

  const inputOptions = {
    input: depObject,
    plugins: [
      supportNodeBuiltins && rollupPluginNodeBuiltins(),
      rollupPluginNodeResolve({
        module: true, // Default: true
        jsnext: false,  // Default: false
        browser: false,  // Default: false
        main: supportsCJS,  // Default: true
        modulesOnly: !supportsCJS, // Default: false
        extensions: [ '.mjs', '.js', '.json' ],  // Default: [ '.mjs', '.js', '.json', '.node' ]
        jail: path.join(cwd, 'node_modules'),
        // whether to prefer built-in modules (e.g. `fs`, `path`) or local ones with the same names
        preferBuiltins: false,  // Default: true
      }),
      supportsCJS && rollupPluginCommonjs({
        extensions: [ '.js', '.cjs' ],  // Default: [ '.js' ]
        ignoreGlobal: supportNodeBuiltins, // false normally, unless Node Builtins are supported.
      }),
      supportNodeBuiltins && rollupPluginNodeGlobals(),
    ],
    onwarn: ((err, defaultOnWarn) => {
      if (err.code === 'UNRESOLVED_IMPORT' && isBuiltin(err.source)) {
        err.message += `\n  ${chalk.dim('[@pika/web: Use the --builtins CLI flag to polyfill/shim Node.js built-in modules.]')}`;
      }
      defaultOnWarn(err);
    }) as any
  };
  const outputOptions = {
    dir: path.join(cwd, "web_modules"),
    format: "esm" as 'esm',
    sourcemap: true,
    exports: 'named' as 'named',
    chunkFileNames: "common/[name]-[hash].js"
  };
  const packageBundle = await rollup.rollup(inputOptions);
  await packageBundle.write(outputOptions);
  return true;
}


export async function cli(args: string[]) {
  const {help, strict, builtins} = yargs(args);

	if (help) {
    showHelp();
    process.exit(0);
  }

  const cwdManifest = require(path.join(cwd, 'package.json'));
  const isWhitelist = !!cwdManifest && !!cwdManifest['@pika/web'] && !!cwdManifest['@pika/web'].webDependencies;
  const arrayOfDeps = isWhitelist ? cwdManifest['@pika/web'].webDependencies : Object.keys(cwdManifest.dependencies || {});
  spinner.start();
  const startTime = Date.now();
  const result = await install(arrayOfDeps, {isWhitelist, supportsCJS: !strict, supportNodeBuiltins: builtins});
  if (result) {
    spinner.succeed(chalk.green.bold(`@pika/web`) + ` installed web-native dependencies. ` + chalk.dim(`[${((Date.now() - startTime) / 1000).toFixed(2)}s]`));
  }
}