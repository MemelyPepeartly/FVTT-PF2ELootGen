/*
 * Copyright 2021 Andrew Cuccinello
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import ModuleSettings from '../ModuleSettings';

/**
 * Chat command processor
 * @internal
 */
export abstract class ChatCommand {
    public get CommandPrefix() {
        return `/${ModuleSettings.instance.moduleName}`;
    }

    public abstract get CommandName(): string;

    /**
     * Validate the command should run.
     * @param message
     */
    public shouldRun(message: string): boolean {
        const command = message.split(' ');
        if (command[0] !== this.CommandPrefix) {
            return false;
        }
        if (command[1] !== this.CommandName) {
            return false;
        }
        return true;
    }

    /**
     * Execute the command, returning true if the command completes successfully
     * @param command
     */
    public execute(command: string): boolean {
        const args = command.split(' ');

        args.shift(); // slash + prefix
        args.shift(); // command name

        this.run(args)
            .then(() => {
                let message = `${this.CommandName} completed successfully.`;
                ui.notifications?.info(message);
            })
            .catch((error) => {
                let message = `${this.CommandName} failed to complete.`;
                ui.notifications?.error(message);
                console.error(error);
            });

        return true;
    }

    /**
     * Run the command
     * @param args
     * @protected
     */
    protected abstract run(args: string[]): Promise<void>;

    // </editor-fold>
}
