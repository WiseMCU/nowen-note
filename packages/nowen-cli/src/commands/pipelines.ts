import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { getClient } from "../cli.js";

export function registerPipelinesCommands(program: Command) {
  const pipelines = program
    .command("pipelines")
    .description("批处理管道管理");

  // nowen pipelines list
  pipelines
    .command("list")
    .description("列出管道")
    .action(async () => {
      const spinner = ora("加载管道...").start();
      try {
        const client = getClient();
        const list = await client.request("/api/pipelines");
        spinner.stop();

        if (list.length === 0) {
          console.log(chalk.yellow("暂无管道"));
          return;
        }

        const table = new Table({
          head: [chalk.cyan("ID"), chalk.cyan("名称"), chalk.cyan("步骤"), chalk.cyan("类型")],
          colWidths: [10, 25, 30, 10],
        });

        for (const p of list) {
          const steps = (p.steps || []).map((s: any) => s.type).join(" → ");
          table.push([
            p.id.slice(0, 8),
            `${p.icon} ${p.name}`,
            steps.slice(0, 28),
            p.isBuiltin ? "内置" : "自定义",
          ]);
        }

        console.log(table.toString());
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen pipelines run <id>
  pipelines
    .command("run <id>")
    .description("运行管道")
    .requiredOption("-n, --notes <ids...>", "要处理的笔记 ID 列表（空格分隔）")
    .action(async (id, opts) => {
      const noteIds = opts.notes;
      const spinner = ora(`执行管道，处理 ${noteIds.length} 篇笔记...`).start();
      try {
        const client = getClient();
        const result = await client.request(`/api/pipelines/${id}/run`, {
          method: "POST",
          body: { noteIds },
        });
        spinner.stop();

        console.log(chalk.bold(`\n⚡ ${result.pipelineName} 执行完成`));
        console.log(`  总计: ${result.total}  成功: ${chalk.green(result.success)}  失败: ${chalk.red(result.failed)}\n`);

        for (const r of result.results) {
          const icon = r.success ? chalk.green("✓") : chalk.red("✗");
          console.log(`  ${icon} ${r.title || "无标题"}`);
          if (!r.success) {
            const failStep = r.steps.find((s: any) => !s.success);
            if (failStep?.error) {
              console.log(chalk.gray(`    └ ${failStep.error}`));
            }
          }
        }
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen pipelines step-types
  pipelines
    .command("step-types")
    .description("列出可用的步骤类型")
    .action(async () => {
      try {
        const client = getClient();
        const types = await client.request("/api/pipelines/step-types");
        console.log(chalk.bold("⚡ 可用步骤类型:\n"));
        for (const t of types) {
          console.log(`  ${t.icon} ${chalk.bold(t.type)} — ${t.name}`);
          console.log(chalk.gray(`    ${t.description}`));
        }
      } catch (err: any) {
        console.error(chalk.red(err.message));
      }
    });

  // nowen pipelines history
  pipelines
    .command("history")
    .description("查看运行历史")
    .action(async () => {
      const spinner = ora("加载历史...").start();
      try {
        const client = getClient();
        const runs = await client.request("/api/pipelines/runs");
        spinner.stop();

        if (runs.length === 0) {
          console.log(chalk.yellow("暂无运行历史"));
          return;
        }

        for (const run of runs) {
          const status = run.status === "completed" ? chalk.green("✓ 完成") : chalk.yellow("⏳ 运行中");
          console.log(`  ${run.pipelineIcon || "⚡"} ${chalk.bold(run.pipelineName || "未知")} ${status}`);
          console.log(chalk.gray(`    ${new Date(run.startedAt).toLocaleString()} | ${run.successNotes}/${run.totalNotes} 成功`));
        }
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });
}
