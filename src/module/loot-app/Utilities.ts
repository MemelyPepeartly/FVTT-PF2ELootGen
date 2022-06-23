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

import { DocumentClassForCompendiumMetadata } from '@league-of-foundry-developers/foundry-vtt-types/src/foundry/client/data/collections/compendium';
import { DICE_ROLL_MODES } from '@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/constants.mjs';
import { ChatMessageDataConstructorData } from '@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData';
import { MODULE_NAME, PF2E_LOOT_SHEET_NAME, QUICK_MYSTIFY, TOOLBOX_NAME } from '../Constants';
import { FEATURE_OUTPUT_LOOT_ROLLS, FEATURE_OUTPUT_LOOT_ROLLS_WHISPER } from '../Setup';
import ModuleSettings from '../../../FVTT-Common/src/module/ModuleSettings';
import { PF2EItem, ConsumableItem, isSpell, SpellItem, isTreasure, PhysicalItem, isPhysicalItem, PriceString, EquipmentType, isWeapon, isShield, isArmor, Shield, EquipmentItem, PreciousMaterialType, PreciousMaterialGrade, PropertyRuneType } from '../../types/PF2E';
import { ItemMaterials, isWeaponArmorData } from './data/Materials';
import { PotencyRuneType, FundamentalRuneType, ItemRunes } from './data/Runes';
import { FilterType, AppFilter, spellSchoolFilters, spellLevelFilters, spellTraditionFilters, spellRarityFilters } from './Filters';
import { consumableSources } from './source/Consumable';
import { GenType, DataSource, isTableSource, isPackSource, isPoolSource } from './source/DataSource';
import { permanentSources } from './source/Permanent';
import { spellSources, SpellItemType, wandTemplateIds, TEMPLATE_PACK_ID, scrollTemplateIds } from './source/Spells';
import { treasureSources, TreasureSource, isTreasureSource } from './source/Treasure';
import { SystemData } from '@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/packages.mjs';


/**
 * Returns distinct elements of an array when used to filter an array.
 * @param value
 * @param index
 * @param array
 */
export function distinct<T>(value: T, index: number, array: T[]): boolean {
    return array.indexOf(value) === index;
}

/**
 * Choose a random element from the array.
 * @param choices The array of choices.
 */
function chooseFromArray<T>(choices: T[]): T {
    return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * Return the correct source map for the given item type.
 * @param type Type of sources to fetch.
 */
export function dataSourcesOfType(type: GenType): Record<string, DataSource> {
    switch (type) {
        case GenType.Treasure:
            return treasureSources;
        case GenType.Permanent:
            return permanentSources;
        case GenType.Consumable:
            return consumableSources;
        case GenType.Spell:
            return spellSources;
    }
}

export function filtersOfType(type: FilterType): Record<string, AppFilter> {
    switch (type) {
        case FilterType.SpellSchool:
            return spellSchoolFilters;
        case FilterType.SpellLevel:
            return spellLevelFilters;
        case FilterType.SpellTradition:
            return spellTraditionFilters;
        case FilterType.SpellRarity:
            return spellRarityFilters;
    }
}

/**
 * Get an item with an id of itemId from the pack with id packId.
 * @param packId
 * @param itemId
 */
export async function getItemFromPack<T = DocumentClassForCompendiumMetadata<CompendiumCollection.Metadata>>(
    packId: string,
    itemId: string,
): Promise<T | undefined> {
    const pack = await game.packs?.get(packId);
    if (pack === undefined) {
        return undefined;
    }
    const result = await pack.getDocument(itemId);
    if (!result) {
        return undefined;
    }
    return result as unknown as T;
}

export interface DrawOptions {}
export interface DrawResult {
    itemData: PF2EItem;
    source: DataSource;
}
export interface SpellDrawResult extends DrawResult {}

/**
 * Draw from a series of data sources and return the item data for the items drawn, along with their source tables.
 * @param count The number of items to draw.
 * @param sources The data sources available to be drawn from.
 * @param options Options
 */
export async function drawFromSources(count: number, sources: DataSource[], options?: DrawOptions): Promise<DrawResult[]> {
    if (options === undefined) {
        options = {};
    }

    if (sources.length === 0) {
        return [];
    }
    sources = duplicate(sources) as DataSource[];

    let weightTotal = 0;
    sources.forEach((source) => {
        weightTotal += source.weight;
        source.weight = weightTotal;
    });

    const chooseSource = () => {
        let choice = sources[0];
        const random = Math.random() * weightTotal;
        for (let i = 1; i < sources.length; i++) {
            if (random < choice.weight) break;
            choice = sources[i];
        }
        return choice;
    };

    const results: DrawResult[] = [];
    for (let i = 0; i < count; i++) {
        const source = chooseSource();

        let item: PF2EItem | undefined;
        if (isTableSource(source)) {
            const table = await getItemFromPack<RollTable>(source.tableSource.id, source.id);

            // @ts-ignore
            const draw: any = await table.roll({ roll: null, recursive: true });
            const [result]: [LootTableResult] = draw.results;

            if (result.data.resultId) {
                item = await getItemFromPack(result.data.collection, result.data.resultId);
            } else {
                // TODO: Create random weapons/armor/gear of rolled type
                i -= 1;
                continue;
            }
        } else if (isPackSource(source)) {
            // @ts-ignore
            const itemId: string = chooseFromArray(getPack(source).index.contents).key;
            item = await getItemFromPack(source.id, itemId);
        } else if (isPoolSource(source)) {
            item = chooseFromArray(source.elements);
        } else {
            throw new Error(`Unknown source type: ${source.sourceType}`);
        }

        if (item === undefined) {
            i -= 1;
            continue;
        }

        results.push({
            itemData: item,
            source: source,
        });
    }

    return results;
}

export async function createSpellItems(itemDatas: DrawResult[], itemTypes: SpellItemType[]): Promise<PF2EItem[]> {
    itemDatas = duplicate(itemDatas) as DrawResult[];

    const itemType = (draw: DrawResult): SpellItemType | undefined => {
        if (draw.itemData.data.level?.value === 10) {
            if (itemTypes.includes(SpellItemType.Scroll)) {
                return SpellItemType.Scroll;
            } else {
                return undefined;
            }
        }
        return chooseFromArray(itemTypes);
    };

    const itemName = (itemData: PF2EItem, type: SpellItemType): string => {
        // TODO: Localization
        switch (type) {
            case SpellItemType.Scroll:
                return `Scroll of ${itemData.name} (Level ${itemData.data.level?.value})`;
            case SpellItemType.Wand:
                return `Wand of ${itemData.name} (Level ${itemData.data.level?.value})`;
        }
    };

    const templates: Record<SpellItemType, ConsumableItem[]> = {
        [SpellItemType.Wand]: (await Promise.all(
            Object.values(wandTemplateIds).map((id) => getItemFromPack<ConsumableItem>(TEMPLATE_PACK_ID, id)),
        )) as ConsumableItem[],
        [SpellItemType.Scroll]: (await Promise.all(
            Object.values(scrollTemplateIds).map((id) => getItemFromPack<ConsumableItem>(TEMPLATE_PACK_ID, id)),
        )) as ConsumableItem[],
    };

    let wandMessage: boolean = false;
    const results: PF2EItem[] = [];
    while (itemDatas.length > 0) {
        const drawResult = itemDatas.shift() as DrawResult;
        const type = itemType(drawResult);

        if (type === undefined) {
            if (!wandMessage) {
                ui.notifications?.warn(`Cannot create a magic wand for provided spell: ${drawResult.itemData.name}`);
                wandMessage = true;
            }
            continue;
        }

        if (isSpell(drawResult.itemData)) {
            const spellData = drawResult.itemData as SpellItem;
            const template = duplicate(templates[type][drawResult.itemData.data.level.value - 1]) as ConsumableItem;
            template.data.traits.value.push(...spellData.data.traditions.value);
            template.data.traits.rarity.value = spellData.data.traits.rarity.value;
            template.name = itemName(spellData, type);

            const description = template.data.description.value;
            template.data.description.value = `@Compendium[pf2e.spells-srd.${spellData._id}]{${spellData.name}}\n<hr/>${description}`;
            template.data.spell = {
                data: duplicate(spellData) as SpellItem,
                heightenedLevel: spellData.data.level.value,
            };

            results.push(template);
        }
    }

    return results;
}

/**
 * Roll and create a new set of item data for the values of treasure items in the results
 * @param results The results to duplicate and then modify
 */
export async function rollTreasureValues(results: DrawResult[]) {
    const rollValue = async (source: TreasureSource): Promise<number> => {
        const roll = await new Roll(source.value).roll({ async: true });
        return roll.total!;
    };

    results = duplicate(results) as DrawResult[];
    for (const result of results) {
        if (isTreasureSource(result.source) && isTreasure(result.itemData)) {
            result.itemData.data.value.value = await rollValue(result.source);
        }
    }

    return results;
}

export async function maybeOutputItemsToChat(results: PhysicalItem[]) {
    if (!ModuleSettings.instance.get<boolean>(FEATURE_OUTPUT_LOOT_ROLLS)) {
        return;
    }

    results = mergeStacks(results) as PhysicalItem[];

    const data: Record<string, any> = {};
    data['description'] = `Rolled ${results.length} items.`;
    data['results'] = results.map((item) => {
        return {
            id: item._id,
            icon: item.img,
            text: `@Compendium[pf2e.equipment-srd.${item._id}]{${item.data.quantity.value}x ${item.name}}`,
        };
    });

    const template = await renderTemplate(`modules/${MODULE_NAME}/templates/chat/table-output.html`, data);

    const rollModeArgs: Partial<ChatMessageDataConstructorData> = {};
    const gmIds = game.users!.filter((user) => user.isGM).map((user) => user.id!);
    let rollMode = game.settings.get('core', 'rollMode') as DICE_ROLL_MODES;
    if (ModuleSettings.instance.get<boolean>(FEATURE_OUTPUT_LOOT_ROLLS_WHISPER)) {
        rollMode = 'gmroll';
    }

    switch (rollMode) {
        case 'blindroll':
            rollModeArgs.blind = true;
            rollModeArgs.whisper = gmIds;
            break;
        case 'publicroll':
            break;
        case 'selfroll':
            rollModeArgs.whisper = [game.user?.id!];
            break;
        case 'gmroll':
            rollModeArgs.whisper = gmIds;
            break;
    }

    await ChatMessage.create({
        user: game.user?.id!,
        content: template,
        ...rollModeArgs,
    });
}

export interface MergeStacksOptions {
    /**
     * Should values be compared when determining uniqueness?
     */
    compareValues?: boolean;
}

/**
 * Get a function that correctly fetches a slug from an item data given the options.
 * @param options
 */
const getSlugFunction = (options: MergeStacksOptions) => {
    // Our slugs are human readable unique ids, in our case when we want to
    // compare the values as well we can append the value to the slug and get
    // a pseudo-hash to use for comparison instead
    let getSlug: (i: PF2EItem) => string;
    if (options.compareValues) {
        getSlug = (i: PF2EItem) => {
            if (isPhysicalItem(i)) {
                // TODO: Need to convert currency types.
                return `${i.data.slug}-${i.data.price}`;
            } else {
                return i.data.slug;
            }
        };
    } else {
        getSlug = (i) => i.data.slug;
    }
    return getSlug;
};

/**
 *  * Takes two sets of itemDatas, and attempts to merge all the new datas into the old datas.
 * Returns an array of items that were unable to be merges
 * @param oldDatas
 * @param newDatas
 * @param options
 * @returns [merged, remaining]
 *  merged: The successfully merged old + new items
 *  remaining: items that could not be merged.
 */
export function mergeExistingStacks(oldDatas: PF2EItem[], newDatas: PF2EItem[], options?: MergeStacksOptions) {
    if (options === undefined) {
        options = { compareValues: true };
    }

    const getSlug = getSlugFunction(options);

    oldDatas = duplicate(oldDatas) as PF2EItem[];
    newDatas = duplicate(newDatas) as PF2EItem[];

    const oldSlugs = oldDatas.map(getSlug);
    const newSlugs = newDatas.map(getSlug);

    for (let i = newSlugs.length - 1; i >= 0; i--) {
        const index = oldSlugs.indexOf(newSlugs[i]);
        if (index === -1) continue;

        const sourceItem = oldDatas[index];
        const targetItem = newDatas[i];

        if (!isPhysicalItem(sourceItem)) continue;
        if (!isPhysicalItem(targetItem)) continue;

        mergeItem(sourceItem, targetItem);
        newDatas.splice(i, 1);
    }

    newDatas = mergeStacks(newDatas, options);

    return [oldDatas, newDatas];
}

/**
 * Merge an array of item datas into a set of stacked items of the same slug
 *  and optionally also compare and do not merge items based on provided options.
 * @param itemDatas
 * @param options
 */
export function mergeStacks(itemDatas: PF2EItem[], options?: MergeStacksOptions) {
    if (options === undefined) {
        options = { compareValues: true };
    }

    itemDatas = duplicate(itemDatas) as PF2EItem[];

    const getSlug = getSlugFunction(options);

    let allSlugs: string[] = itemDatas.map(getSlug);
    const unqSlugs = allSlugs.filter(distinct);
    for (const slug of unqSlugs) {
        // we'll keep the first item in the array, and discard the rest
        const first = allSlugs.indexOf(slug);
        const sourceItem = itemDatas[first];

        if (!isPhysicalItem(sourceItem)) continue;

        for (let i = itemDatas.length - 1; i > first; i--) {
            const targetItem = itemDatas[i];

            if (!isPhysicalItem(targetItem)) continue;
            if (getSlug(targetItem) !== slug) continue;

            mergeItem(sourceItem, targetItem);

            itemDatas.splice(i, 1);
            allSlugs.splice(i, 1);
        }
    }

    return itemDatas;
}

/**
 * Merge item a IN PLACE by incrementing it's quantity by item b's quantity.
 * @param a The target item
 * @param b The item to increase the target by
 */
export function mergeItem(a: PhysicalItem, b: PhysicalItem) {
    a.data.quantity.value += b.data.quantity.value;
}

/**
 * Parse a price ending in {cp|sp|gp|pp} to gp
 * @param price
 */
export function parsePrice(price: PriceString): number {
    const multiples: Record<string, number> = {
        cp: 1 / 100,
        sp: 1 / 10,
        gp: 1,
        pp: 10,
    };

    const matches = price.toString().toLowerCase().match(/([0-9]+)(.*)(cp|sp|gp|pp)/);
    if (matches === null) {
        return 0;
    }

    return parseInt(matches[1].trim()) * multiples[matches[3].trim()];
}

/**
 * Parse a weight string, returning an absolute numeric representation of the weight
 * @param item
 */
export function getItemBulkMultiplier(item: PhysicalItem): number {
    const weightString = item.data.weight.value.trim().toLowerCase();
    if (weightString.endsWith('l')) {
        return parseInt(weightString.substr(weightString.length - 1)) / 10;
    } else {
        return parseInt(weightString);
    }
}

/**
 * Select the correct EquipmentType for this item
 * @param item
 */
export function getEquipmentType(item: PF2EItem): EquipmentType | undefined {
    if (isWeapon(item)) {
        return EquipmentType.Weapon;
    } else if (isShield(item)) {
        return inferShieldType(item) ?? EquipmentType.Shield;
    } else if (isArmor(item)) {
        return EquipmentType.Armor;
    } else {
        return undefined;
    }
}

/**
 * Infer shield type from ac/bulk
 * @param item
 */
export function inferShieldType(item: Shield): EquipmentType | undefined {
    if (item.data.armor.value === 1) {
        return EquipmentType.Buckler;
    }

    try {
        // out of the remaining shields, towers have a bulk more than 1
        const bulk = parseInt(item.data.weight.value);
        if (bulk > 1) {
            return EquipmentType.Tower;
        } else {
            return EquipmentType.Shield;
        }
    } catch (e) {
        return undefined;
    }
}

interface FinalPriceAndLevelArgs {
    item: EquipmentItem;
    materialType: PreciousMaterialType;
    materialGradeType: PreciousMaterialGrade;
    potencyRune: PotencyRuneType;
    fundamentalRune: FundamentalRuneType;
    propertyRunes: [PropertyRuneType, PropertyRuneType, PropertyRuneType, PropertyRuneType];
}
interface FinalPriceAndLevelResults {
    level: number;
    price: number;
    hardness: number;
    hitPoints: number;
    brokenThreshold: number;
}

/**
 * Given an item and a set of changes, compute the final price and level of the item.
 * @param args
 */
export function calculateFinalPriceAndLevel(args: FinalPriceAndLevelArgs): FinalPriceAndLevelResults {
    const equipmentType = getEquipmentType(args.item);
    if (equipmentType === undefined) {
        return {
            level: 0,
            price: 0,
            hardness: 0,
            hitPoints: 0,
            brokenThreshold: 0,
        };
    }
    let finalLevel = parseInt(args.item.data.level.value.toString());
    /**
     * // TODO: This just goes by gold value for now. Making it parse down to a string causes the weapon to not be openable or a 
     * parsable object for Foundry will need factoring to account for other smaller currencies 
     */
    let finalPrice = args.item.data.price.value.gp;
    let finalHardness = parseInt(args.item.data.hardness.toString());
    let finalHitPoints = args.item.data.hp.value;
    let finalBreakThreshold = args.item.data.hp.brokenThreshold;
    
    const materialData = ItemMaterials[args.materialType][equipmentType]?.[args.materialGradeType];
    if (materialData) {
        finalLevel = Math.max(finalLevel, materialData.level);
        finalPrice += materialData.price.basePrice;
        if (isWeaponArmorData(materialData)) {
            finalPrice += materialData.price.bulkPrice * getItemBulkMultiplier(args.item);
        } else {
            finalHardness = materialData.durability.hardness;
            finalHitPoints = materialData.durability.hitPoints;
            finalBreakThreshold = materialData.durability.brokenThreshold;
        }
    }
    
    const potencyRuneData = ItemRunes[equipmentType]['potency']?.[args.potencyRune];
    if (potencyRuneData) {
        finalLevel = Math.max(finalLevel, potencyRuneData.level);
        finalPrice += potencyRuneData.price.basePrice;
    }

    for (const propertyRuneType of args.propertyRunes) {
        const propertyRuneData = ItemRunes[equipmentType]['property'][propertyRuneType];
        if (propertyRuneData) {
            finalLevel = Math.max(finalLevel, propertyRuneData.level);
            finalPrice += propertyRuneData.price.basePrice;
        }
    }

    const fundamentalRuneData = ItemRunes[equipmentType]['fundamental'][args.fundamentalRune];
    if (fundamentalRuneData) {
        finalLevel = Math.max(finalLevel, fundamentalRuneData.level);
        finalPrice += fundamentalRuneData.price.basePrice;
    }

    return {
        level: finalLevel,
        price: finalPrice,
        hardness: finalHardness,
        hitPoints: finalHitPoints,
        brokenThreshold: finalBreakThreshold,
    };
}

/**
 * Mystify all items **IN PLACE** so they are unidentified
 * @param items
 */
export function mystifyItems(...items: PhysicalItem[]): PhysicalItem[] {
    for (const item of items) {
        item.data.identification.status = 'unidentified';
    }
    return items;
}

/**
 * Mystify all items **IN PLACE** if quick mystification is enabled in Toolbox and alt is held in the event
 * @param event
 * @param items
 */
export function maybeMystifyItems(event: JQuery.ClickEvent, ...items: PhysicalItem[]): PhysicalItem[] {
    const mystifyEnabled = game.settings.get(TOOLBOX_NAME, QUICK_MYSTIFY) as boolean;
    if (mystifyEnabled && event.altKey) {
        items = mystifyItems(...items);
    }
    return items;
}
