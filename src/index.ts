#!/usr/bin/env node

import * as yargs from "yargs";
import { Manager } from "./manager";
import { update } from "./commands/update";
import { run } from "./commands/run";
import { build } from "./commands/build";
import { docs } from "./commands/docs";

const manager = new Manager();

const argv = yargs
    .scriptName("ham")
    .command("update", "performs addon updates", (args) =>
    {
        return args
            .option("patch", {
                alias: "p",
                default: false,
                boolean: true
            })
            .option("noGit", {
                alias: "n",
                default: false,
                boolean: true
            });
    }, (opts) =>
    {
        update(manager, opts);
    })
    .command("run <addon>", "runs an addon", (argv) =>
        argv
            .option("clean", { alias: "c", default: false, boolean: true })
            .option("nobuild", { alias: "n", default: false, boolean: true }),
        (opts) =>
        {
            run(manager, opts);
        })
    .command("build <addon>", "builds an addon", (argv) =>
        argv
            .option("nocheck", { alias: "n", default: false, boolean: true })
            .option("notest", { alias: "t", default: false, boolean: true })
            .option("user", { alias: "u", default: null, boolean: false })
            .option("password", { alias: "p", default: null, boolean: false })
            .option("arch", { alias: "a", default: null, boolean: false }),
        (opts) =>
        {
            build(manager, opts);
        })
    .command("docs", "generate/update readme files", (argv)=>
        argv,
        (opts) =>
        {
            docs(manager, opts);
        })
    .argv;


