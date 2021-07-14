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

import { permanentSources } from './source/Permanent';
import { consumableSources } from './source/Consumable';
import { isTreasureSource, TreasureSource, treasureSources } from './source/Treasure';
import { TEMPLATE_PACK_ID, scrollTemplateIds, SpellItemType, spellSources, wandTemplateIds } from './source/Spells';
import { DataSource, getPack, isPackSource, isPoolSource, isTableSource, GenType } from './source/DataSource';
import { getItemFromPack, getTableFromPack } from '../Utilities';
import { AppFilter, FilterType, spellLevelFilters, spellSchoolFilters, spellTraditionFilters } from './Filters';
import {
    ConsumableItem,
    EquipmentItem,
    isPhysicalItem,
    isSpell,
    isTreasure,
    PF2EItem,
    PhysicalItem,
    PreciousMaterialGrade,
    PreciousMaterialType,
    PriceString,
    PropertyRuneType,
    SpellItem,
} from '../../types/PF2E';
import { EquipmentType, getEquipmentType, ItemMaterials } from './data/Materials';
import { FundamentalRuneType, PotencyRuneType } from './data/Runes';

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
    }
}

export interface DrawOptions {
    displayChat?: boolean;
}
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
        options = {
            displayChat: true,
        };
    }

    if (sources.length === 0) {
        return [];
    }
    sources = duplicate(sources) as DataSource[];

    let weightTotal = 0;
    sources.forEach((source) => {
        weightTotal += source.weight;
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

        // TODO: Something is "weird" with the table weights, seeming to prefer very high level items and large groups
        //  of the same item are being created, even with all tables enabled and evenly weighted
        let item: PF2EItem;
        if (isTableSource(source)) {
            const table = await getTableFromPack(source.id, source.tableSource.id);

            // @ts-ignore
            const draw = await table.roll({ roll: null, recursive: true });
            const [result]: [TableResult] = draw.results;

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

        results.push({
            itemData: item,
            source: source,
        });
    }

    // if (options.displayChat) {
    //     await buildRollTableMessage(results);
    // }
    return results;
}

export async function createSpellItems(itemDatas: DrawResult[], itemTypes: SpellItemType[]): Promise<PF2EItem[]> {
    itemDatas = duplicate(itemDatas) as DrawResult[];

    console.warn(itemTypes);

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
        [SpellItemType.Wand]: (await Promise.all(Object.values(wandTemplateIds).map((id) => getItemFromPack(TEMPLATE_PACK_ID, id)))) as ConsumableItem[],
        [SpellItemType.Scroll]: (await Promise.all(Object.values(scrollTemplateIds).map((id) => getItemFromPack(TEMPLATE_PACK_ID, id)))) as ConsumableItem[],
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

    const matches = price.toLowerCase().match(/([0-9]+)(.*)(cp|sp|gp|pp)/);
    if (matches === null) {
        return 0;
    }

    const priceString = matches[0];
    const denomString = matches[2];
    const priceValue = parseInt(priceString);
    const denomValue = multiples[denomString];
    return priceValue * denomValue;
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
}
/**
 * Given an item and a set of changes, compute the final price and level of the item.
 * @param args
 */
export function calculateFinalPriceAndLevel(args: FinalPriceAndLevelArgs): FinalPriceAndLevelResults {
    let finalLevel = 0;
    let finalPrice = 0;

    const equipmentType = getEquipmentType(args.item);
    if (equipmentType === undefined) {
        return {
            level: finalLevel,
            price: finalPrice,
        };
    }

    if (args.materialType !== '') {
        const materialForEquipment = ItemMaterials[args.materialType][equipmentType];
        if (materialForEquipment) {
            // TODO: Finish writing
        }
    }

    switch (equipmentType) {
        case EquipmentType.Weapon:
            break;
        case EquipmentType.Armor:
            break;
        case EquipmentType.Shield:
            break;
    }

    return {
        level: finalLevel,
        price: finalPrice,
    };
}
