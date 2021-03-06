import Invocation from "./Invocation";
import Command from "./Command";
import Utils from './Utils';
import * as _ from 'lodash';
import PTY from "./PTY";
import * as Path from 'path';

abstract class CommandExecutionStrategy {
    protected args: string[];

    constructor(protected invocation: Invocation, protected command: string) {
        this.args = invocation.getPrompt().arguments.filter(argument => argument.length > 0);
    }

    static async canExecute(command: string): Promise<boolean> {
        return false;
    }

    abstract startExecution(): Promise<{}>;
}

class BuiltInCommandExecutionStrategy extends CommandExecutionStrategy {
    static async canExecute(command: string) {
        return Command.isBuiltIn(command);
    }

    startExecution() {
        return new Promise((resolve, reject) => {
            try {
                Command.executor(this.command)(this.invocation, this.args);
                resolve();
            } catch (error) {
                reject(error.message);
            }
        })
    }
}

class UnixSystemFileExecutionStrategy extends CommandExecutionStrategy {
    static async canExecute(command: string) {
        return _.include(await Utils.getExecutablesInPaths(), command);
    }

    startExecution() {
        return new Promise((resolve, reject) => {
            this.invocation.command = new PTY(
                this.command, this.args, this.invocation.directory, this.invocation.dimensions,
                (data: string) => this.invocation.parser.parse(data),
                (exitCode: number) => exitCode === 0 ? resolve() : reject()
            );
        })
    }
}

class WindowsSystemFileExecutionStrategy extends CommandExecutionStrategy {
    static async canExecute(command: string) {
        return Utils.isWindows;
    }

    startExecution() {
        return new Promise((resolve) => {
            this.invocation.command = new PTY(
                this.cmdPath, ['/s', '/c', this.invocation.getPrompt().expanded.join(' ')], this.invocation.directory, this.invocation.dimensions,
                (data: string) => this.invocation.parser.parse(data),
                (exitCode: number) => resolve()
            );
        })
    }

    private get cmdPath(): string {
        if (process.env.comspec) {
            return process.env.comspec;
        }
        else if (process.env.SystemRoot) {
            return Path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
        }
        else return 'cmd.exe';
    }
}

class NullExecutionStrategy extends CommandExecutionStrategy {
    static async canExecute(command: string) {
        return true;
    }

    startExecution() {
        return new Promise((resolve, reject) => reject(`Black Screen: command "${this.command}" not found.`));
    }
}

export default class CommandExecutor {
    private static executors = [
        BuiltInCommandExecutionStrategy,
        WindowsSystemFileExecutionStrategy,
        UnixSystemFileExecutionStrategy
    ];

    static execute(invocation: Invocation): Promise<CommandExecutionStrategy> {
        var command = invocation.getPrompt().commandName;

        return Utils.filterWithPromising(
            this.executors.concat(NullExecutionStrategy),
            executor => executor.canExecute(command))
            .then(applicableExecutors => new applicableExecutors[0](invocation, command).startExecution()
            );
    }
}

