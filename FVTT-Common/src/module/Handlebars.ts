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

export interface HandlebarsContext {
    data: Record<string, any> & {
        root: Record<string, any>;
    };
    hash?: Record<string, any>;
    // contents of block
    fn?: (context: any) => string;
    // contents of else block
    inverse?: () => string;
    loc?: {
        start: { line: number; column: number };
        end: { line: number; column: number };
    };
    name?: string;
}

export function registerHelpers() {
    // absolute equality check
    Handlebars.registerHelper('ifeq', function (this: HandlebarsContext, a: any, b: any, options: HandlebarsContext) {
        if (a === b) {
            if (!options.fn) {
                return '';
            }
            return options.fn(this);
        } else {
            if (!options.inverse) {
                return '';
            }
            return options.inverse();
        }
    });
}
