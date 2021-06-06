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

import Settings from './settings-app/Settings';
import { registerHandlebarsHelpers, registerHandlebarsTemplates } from './Handlebars';
import { getTable, permanentItemsTables, rollMany } from './data/Tables';

Hooks.on('init', Settings.registerAllSettings);

Hooks.on('init', Settings.onInit);
Hooks.on('setup', Settings.onSetup);
Hooks.on('ready', Settings.onReady);

Hooks.on('setup', registerHandlebarsTemplates);
Hooks.on('setup', registerHandlebarsHelpers);

Hooks.on('ready', async () => {
    for (let tableDef of permanentItemsTables) {
        if (!tableDef.name.startsWith('10')) continue;
        const table = await getTable(tableDef.id);
        const results = await rollMany(table, 20);
    }
});
