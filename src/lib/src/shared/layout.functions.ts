import { BehaviorSubject } from 'rxjs/BehaviorSubject';

import * as _ from 'lodash';

import { TitleMapItem } from '../json-schema-form.service';
import {
  inArray, isArray, isEmpty, isNumber, isObject, isDefined, isString
} from './validator.functions';
import { copy, fixTitle, forEach, hasOwn } from './utility.functions';
import { Pointer, JsonPointer } from './jsonpointer.functions';
import {
  getFromSchema, getInputType, getSubSchema, checkInlineType, isInputRequired,
  removeRecursiveReferences, updateInputOptions
} from './json-schema.functions';
import { buildFormGroupTemplate, getControl } from './form-group.functions';

/**
 * Layout function library:
 *
 * buildLayout:            Builds a complete layout from an input layout and schema
 *
 * buildLayoutFromSchema:  Builds a complete layout entirely from an input schema
 *
 * mapLayout:
 *
 * getLayoutNode:
 *
 * buildTitleMap:
 */

/**
 * 'buildLayout' function
 *
 * @param {any} jsf
 * @param {any} widgetLibrary
 * @return {any[]}
 */
export function buildLayout(jsf: any, widgetLibrary: any): any[] {
  let hasSubmitButton = !JsonPointer.get(jsf, '/globalOptions/addSubmit');
  let formLayout = mapLayout(jsf.layout, (layoutItem, index, layoutPointer) => {
    let currentIndex: number = index;
    let newNode: any = {
      _id: _.uniqueId(),
      layoutPointer: layoutPointer.replace(/\/\d+/g, '/-'),
      options: {},
    };
    if (isObject(layoutItem)) {
      Object.assign(newNode, layoutItem);
      Object.keys(newNode)
        .filter(option => !inArray(option, [
          '_id', '$ref', 'arrayItem', 'arrayItemType', 'dataPointer',
          'dataType', 'items', 'key', 'layoutPointer', 'name', 'options',
          'recursiveReference', 'type', 'widget'
        ]))
        .forEach(option => {
          newNode.options[option] = newNode[option];
          delete newNode[option];
        });
      if (!hasOwn(newNode, 'type') && isString(newNode.widget)) {
        newNode.type = newNode.widget;
        delete newNode.widget;
      }
      if (!hasOwn(newNode.options, 'title')) {
        if (hasOwn(newNode.options, 'legend')) {
          newNode.options.title = newNode.options.legend;
          delete newNode.options.legend;
        } else if (hasOwn(newNode, 'name') && !/^\d+$/.test(newNode.name)) {
          newNode.options.title = fixTitle(newNode.name);
        }
      }
    } else if (JsonPointer.isJsonPointer(layoutItem)) {
      newNode.dataPointer = layoutItem;
    } else if (isString(layoutItem)) {
      newNode.key = layoutItem;
    } else {
      console.error('buildLayout error: Form layout element not recognized:');
      console.error(layoutItem);
      return null;
    }
    let nodeSchema: any = null;

    // If newNode does not have a dataPointer, try to find an equivalent
    if (!hasOwn(newNode, 'dataPointer')) {

      // If newNode has a key, change it to a dataPointer
      if (hasOwn(newNode, 'key')) {
        newNode.dataPointer = newNode.key === '*' ? newNode.key :
          JsonPointer.compile(JsonPointer.parseObjectPath(newNode.key), '-');
        delete newNode.key;

      // If newNode is an array, search for dataPointer in child nodes
      } else if (hasOwn(newNode, 'type') && newNode.type.slice(-5) === 'array') {
        const findDataPointer = (items) => {
          if (items === null || typeof items !== 'object') { return; }
          if (hasOwn(items, 'dataPointer')) { return items.dataPointer; }
          if (isArray(items.items)) {
            for (let item of items.items) {
              if (hasOwn(item, 'dataPointer') && item.dataPointer.indexOf('/-') !== -1) {
                return item.dataPointer;
              }
              if (hasOwn(item, 'items')) {
                const searchItem = findDataPointer(item);
                if (searchItem) { return searchItem; }
              }
            }
          }
        };
        const childDataPointer = findDataPointer(newNode);
        if (childDataPointer) {
          newNode.dataPointer =
            childDataPointer.slice(0, childDataPointer.lastIndexOf('/-'));
        }
      }
    }

    if (hasOwn(newNode, 'dataPointer')) {
      if (newNode.dataPointer === '*') {
        const parentLayoutPointer = newNode.layoutPointer.slice(0, -2);
        return buildLayoutFromSchema(jsf, widgetLibrary, parentLayoutPointer);
      }
      const nodeValue =
        JsonPointer.get(jsf.initialValues, newNode.dataPointer.replace(/\/-/g, '/1'));
      newNode.dataPointer =
        JsonPointer.toGenericPointer(newNode.dataPointer, jsf.arrayMap);
      const LastKey = JsonPointer.toKey(newNode.dataPointer);
      if (!newNode.name && isString(LastKey) && LastKey !== '-') {
        newNode.name = LastKey;
        if (!newNode.options.title && !/^\d+$/.test(newNode.name)) {
          newNode.options.title = fixTitle(newNode.name);
        }
      }
      const shortDataPointer = removeRecursiveReferences(
        newNode.dataPointer, jsf.dataRecursiveRefMap, jsf.arrayMap
      );
      const recursive = shortDataPointer !== newNode.dataPointer;
      let schemaPointer: string;
      if (!jsf.dataMap.has(shortDataPointer)) {
        jsf.dataMap.set(shortDataPointer, new Map());
      }
      const nodeDataMap  = jsf.dataMap.get(shortDataPointer);
      if (nodeDataMap.has('schemaPointer')) {
        schemaPointer = nodeDataMap.get('schemaPointer');
      } else {
        schemaPointer = JsonPointer.toSchemaPointer(shortDataPointer, jsf.schema);
        nodeDataMap.set('schemaPointer', schemaPointer);
      }
      nodeDataMap.set('disabled', !!newNode.options.disabled);
      nodeSchema = JsonPointer.get(jsf.schema, schemaPointer);
      if (nodeSchema) {
        if (!hasOwn(newNode, 'type')) {
          newNode.type = getInputType(nodeSchema, newNode);
        } else if (!widgetLibrary.hasWidget(newNode.type)) {
          const oldWidgetType = newNode.type;
          newNode.type = getInputType(nodeSchema, newNode);
          console.error(`error: widget type "${oldWidgetType}" not found` +
            `in library. Replacing with "${newNode.type}".`);
        } else {
          newNode.type = checkInlineType(newNode.type, nodeSchema, newNode);
        }
        newNode.dataType =
          nodeSchema.type || (hasOwn(nodeSchema, '$ref') ? '$ref' : null);
        updateInputOptions(newNode, nodeSchema, jsf);

        // Present checkboxes as single control, rather than array
        if (newNode.type === 'checkboxes' && hasOwn(nodeSchema, 'items')) {
          updateInputOptions(newNode, nodeSchema.items, jsf);
        } else if (newNode.dataType === 'array') {
          newNode.options.maxItems = Math.min(
            nodeSchema.maxItems || 1000, newNode.options.maxItems || 1000
          );
          newNode.options.minItems = Math.max(
            nodeSchema.minItems || 0, newNode.options.minItems || 0
          );
          newNode.options.listItems = Math.max(
            newNode.options.listItems || 0, isArray(nodeValue) ? nodeValue.length : 0
          );
          newNode.options.tupleItems =
            isArray(nodeSchema.items) ? nodeSchema.items.length : 0;
          if (newNode.options.maxItems < newNode.options.tupleItems) {
            newNode.options.tupleItems = newNode.options.maxItems;
            newNode.options.listItems = 0;
          } else if (newNode.options.maxItems <
            newNode.options.tupleItems + newNode.options.listItems
          ) {
            newNode.options.listItems =
              newNode.options.maxItems - newNode.options.tupleItems;
          } else if (newNode.options.minItems >
            newNode.options.tupleItems + newNode.options.listItems
          ) {
            newNode.options.listItems =
              newNode.options.minItems - newNode.options.tupleItems;
          }
          if (!nodeDataMap.has('maxItems')) {
            nodeDataMap.set('maxItems', newNode.options.maxItems);
            nodeDataMap.set('minItems', newNode.options.minItems);
            nodeDataMap.set('tupleItems', newNode.options.tupleItems);
            nodeDataMap.set('listItems', newNode.options.listItems);
          }
          if (!jsf.arrayMap.has(shortDataPointer)) {
            jsf.arrayMap.set(shortDataPointer, newNode.options.tupleItems)
          }
        }
        if (isInputRequired(jsf.schema, schemaPointer)) {
          newNode.options.required = true;
          jsf.fieldsRequired = true;
        }
      } else {
        // TODO: create item in FormGroup model from layout key (?)
        updateInputOptions(newNode, {}, jsf);
      }

      if (hasOwn(newNode.options, 'copyValueTo')) {
        if (typeof newNode.options.copyValueTo === 'string') {
          newNode.options.copyValueTo = [newNode.options.copyValueTo];
        }
        if (isArray(newNode.options.copyValueTo)) {
          newNode.options.copyValueTo = newNode.options.copyValueTo.map(item =>
            JsonPointer.compile(JsonPointer.parseObjectPath(item), '-')
          );
        }
      }

      newNode.widget = widgetLibrary.getWidget(newNode.type);
      nodeDataMap.set('inputType', newNode.type);
      nodeDataMap.set('widget', newNode.widget);

      if (newNode.dataType === 'array' &&
        (hasOwn(newNode, 'items') || hasOwn(newNode, 'additionalItems'))
      ) {
        let itemRefPointer = removeRecursiveReferences(
          newNode.dataPointer + '/-', jsf.dataRecursiveRefMap, jsf.arrayMap
        );
        if (!jsf.dataMap.has(itemRefPointer)) {
          jsf.dataMap.set(itemRefPointer, new Map());
        }
        jsf.dataMap.get(itemRefPointer).set('inputType', 'section');

        // Fix insufficiently nested array item groups
        if (newNode.items.length > 1) {
          let arrayItemGroup = [];
          let arrayItemGroupTemplate = [];
          let newIndex = 0;
          for (let i = newNode.items.length - 1; i >= 0; i--) {
            let subItem = newNode.items[i];
            if (hasOwn(subItem, 'dataPointer') &&
              subItem.dataPointer.slice(0, itemRefPointer.length) === itemRefPointer
            ) {
              let arrayItem = newNode.items.splice(i, 1)[0];
              let arrayItemTemplate = mapLayout([arrayItem], templateItem => {
                templateItem.layoutPointer = templateItem.layoutPointer
                  .replace(newNode.layoutPointer, newNode.layoutPointer + '/items/-');
                return templateItem;
              })[0];
              arrayItemGroupTemplate.unshift(arrayItemTemplate);
              arrayItem.dataPointer = newNode.dataPointer + '/-' +
                arrayItem.dataPointer.slice(itemRefPointer.length);
              arrayItem.layoutPointer = newNode.layoutPointer + '/items/-/items/-';
              arrayItemGroup.unshift(arrayItem);
              newIndex++;
            } else {
              subItem.arrayItem = true;
              // TODO: Check schema to get arrayItemType and removable
              subItem.arrayItemType = 'list';
              subItem.removable = newNode.options.removable !== false;
            }
          }
          if (arrayItemGroup.length) {
            newNode.items.push({
              _id: _.uniqueId(),
              arrayItem: true,
              arrayItemType: newNode.options.tupleItems > newNode.items.length ?
                'tuple' : 'list',
              items: arrayItemGroup,
              layoutPointer: newNode.layoutPointer + '/items/-',
              options: { removable: newNode.options.removable !== false, },
              dataPointer: newNode.dataPointer + '/-',
              type: 'section',
              widget: widgetLibrary.getWidget('section'),
            });
          }
        } else {
          // TODO: Fix to hndle multiple items
          newNode.items[0].arrayItem = true;
          if (!newNode.items[0].dataPointer) {
            newNode.items[0].dataPointer =
              JsonPointer.toGenericPointer(itemRefPointer, jsf.arrayMap);
          }
          if (!JsonPointer.has(newNode, '/items/0/options/removable')) {
            newNode.items[0].options.removable = true;
          }
          if (newNode.options.orderable === false) {
            newNode.items[0].options.orderable = false;
          }
          newNode.items[0].arrayItemType =
            newNode.options.tupleItems ? 'tuple' : 'list';
        }

        if (isArray(newNode.items)) {
          const arrayListItems =
            newNode.items.filter(item => item.type !== '$ref').length -
              newNode.options.tupleItems;
          if (arrayListItems > newNode.options.listItems) {
            newNode.options.listItems = arrayListItems;
            nodeDataMap.set('listItems', arrayListItems);
          }
        }

        // TODO: check maxItems to verify adding new items is OK, and check
        // additionalItems for whether there is a different schema for new items
        if (newNode.options.addable !== false) {
          if (!hasOwn(jsf.layoutRefLibrary, itemRefPointer)) {
            jsf.layoutRefLibrary[itemRefPointer] =
              _.cloneDeep(newNode.items[newNode.items.length - 1]);
            if (recursive) {
              jsf.layoutRefLibrary[itemRefPointer].recursiveReference = true;
            }
            forEach(jsf.layoutRefLibrary[itemRefPointer], (item, key) => {
              if (hasOwn(item, '_id')) { item._id = null; }
              if (recursive) {
                if (hasOwn(item, 'dataPointer')) {
                  item.dataPointer = item.dataPointer.slice(itemRefPointer.length);
                }
                if (hasOwn(item, 'layoutPointer')) {
                  item.layoutPointer = item.layoutPointer.slice(layoutPointer.length);
                }
              }
            }, 'top-down');
          }
          const arrayLength = Math.min(Math.max(
            newNode.options.tupleItems + newNode.options.listItems,
            isArray(nodeValue) ? nodeValue.length : 0
          ), newNode.options.maxItems);
          for (let i = newNode.items.length; i < arrayLength; i++) {
            newNode.items.push(getLayoutNode({
              $ref: itemRefPointer,
              dataPointer: newNode.dataPointer,
              layoutPointer: newNode.layoutPointer,
              recursiveReference: newNode.recursiveReference,
            }, jsf.layoutRefLibrary));
          }
          let buttonText: string = 'Add';
          if (newNode.options.title) {
            if (/^add\b/i.test(newNode.options.title)) {
              buttonText = newNode.options.title;
            } else {
              buttonText += ' ' + newNode.options.title;
            }
          } else if (newNode.name && !/^\d+$/.test(newNode.name)) {
            if (/^add\b/i.test(newNode.name)) {
              buttonText += ' ' + fixTitle(newNode.name);
            } else {
              buttonText = fixTitle(newNode.name);
            }

          // If newNode doesn't have a title, look for title of parent array item
          } else {
            const parentSchema =
              getFromSchema(jsf.schema, newNode.dataPointer, 'parentSchema');
            if (hasOwn(parentSchema, 'title')) {
              buttonText += ' to ' + parentSchema.title;
            } else {
              const pointerArray = JsonPointer.parse(newNode.dataPointer);
              buttonText += ' to ' + fixTitle(pointerArray[pointerArray.length - 2]);
            }
          }
          newNode.items.push({
            _id: _.uniqueId(),
            arrayItem: true,
            arrayItemType: 'list',
            dataPointer: newNode.dataPointer + '/-',
            layoutPointer: newNode.layoutPointer + '/items/-',
            options: {
              listItems: newNode.options.listItems,
              maxItems: newNode.options.maxItems,
              minItems: newNode.options.minItems,
              removable: false,
              title: buttonText,
              tupleItems: newNode.options.tupleItems,
            },
            recursiveReference: recursive,
            type: '$ref',
            widget: widgetLibrary.getWidget('$ref'),
            $ref: itemRefPointer,
          });
          if (isString(JsonPointer.get(newNode, '/style/add'))) {
            newNode.items[newNode.items.length - 1].options.fieldStyle =
              newNode.style.add;
            delete newNode.style.add;
            if (isEmpty(newNode.style)) { delete newNode.style; }
          }
        }
      } else {
        newNode.arrayItem = false;
      }
    } else if (hasOwn(newNode, 'type') || hasOwn(newNode, 'items')) {
      const parentType: string =
        JsonPointer.get(jsf.layout, layoutPointer, 0, -2).type;
      if (!hasOwn(newNode, 'type')) {
        newNode.type =
          inArray(parentType, ['tabs', 'tabarray']) ? 'tab' : 'array';
      }
      newNode.arrayItem = parentType === 'array';
      newNode.widget = widgetLibrary.getWidget(newNode.type);
      updateInputOptions(newNode, {}, jsf);
    }
    if (newNode.type === 'submit') { hasSubmitButton = true; }
    return newNode;
  });
  if (!hasSubmitButton) {
    formLayout.push({
      _id: _.uniqueId(),
      layoutPointer: '/-',
      options: { title: 'Submit' },
      type: 'submit',
      widget: widgetLibrary.getWidget('submit'),
    });
  }
  return formLayout;
}

/**
 * 'buildLayoutFromSchema' function
 *
 * @param {any} jsf -
 * @param {number = 0} layoutIndex -
 * @param {string = ''} layoutPointer -
 * @param {string = ''} schemaPointer -
 * @param {string = ''} dataPointer -
 * @param {boolean = false} arrayItem -
 * @param {string = null} arrayItemType -
 * @param {boolean = null} removable -
 * @param {boolean = false} forRefLibrary -
 * @return {any}
 */
export function buildLayoutFromSchema(
  jsf: any, widgetLibrary: any, layoutPointer: string = '',
  schemaPointer: string = '', dataPointer: string = '',
  arrayItem: boolean = false, arrayItemType: string = null,
  removable: boolean = null, forRefLibrary: boolean = false,
  dataPointerPrefix: string = ''
): any {
  const schema = JsonPointer.get(jsf.schema, schemaPointer);
  if (!hasOwn(schema, 'type') && !hasOwn(schema, '$ref') &&
    !hasOwn(schema, 'x-schema-form')
  ) { return null; }
  const newNodeType: string = getInputType(schema);
  const nodeValue =
    JsonPointer.get(jsf.initialValues, dataPointer.replace(/\/-/g, '/1'));
  let newNode: any = {
    _id: forRefLibrary ? null : _.uniqueId(),
    arrayItem: arrayItem,
    dataPointer: JsonPointer.toGenericPointer(dataPointer, jsf.arrayMap),
    dataType: schema.type || (hasOwn(schema, '$ref') ? '$ref' : null),
    layoutPointer: layoutPointer.replace(/\/\d+/g, '/-') || '/-',
    options: {},
    type: newNodeType,
    widget: widgetLibrary.getWidget(newNodeType),
  };
  const lastDataKey = JsonPointer.toKey(newNode.dataPointer);
  if (lastDataKey !== '-') { newNode.name = lastDataKey; }
  if (newNode.arrayItem) {
    newNode.arrayItemType = arrayItemType;
    newNode.options.removable = removable !== false;
  }
  const shortDataPointer = removeRecursiveReferences(
    dataPointerPrefix + dataPointer, jsf.dataRecursiveRefMap, jsf.arrayMap
  );
  const recursive  = shortDataPointer !== dataPointerPrefix + dataPointer;
  if (!jsf.dataMap.has(shortDataPointer)) {
    jsf.dataMap.set(shortDataPointer, new Map());
  }
  const nodeDataMap  = jsf.dataMap.get(shortDataPointer);
  if (!nodeDataMap.has('inputType')) {
    nodeDataMap.set('schemaPointer', schemaPointer);
    nodeDataMap.set('inputType', newNode.type);
    nodeDataMap.set('widget', newNode.widget);
    nodeDataMap.set('disabled', !!newNode.options.disabled);
  }
  updateInputOptions(newNode, schema, jsf);
  if (!newNode.options.title && newNode.name && !/^\d+$/.test(newNode.name)) {
    newNode.options.title = fixTitle(newNode.name);
  }

  if (newNode.dataType === 'object') {
    if (!nodeDataMap.has('requiredKeys')) {
      nodeDataMap.set('requiredKeys', new Set());
    }
    if (isObject(schema.properties)) {
      const newSection: any[] = [];
      const propertyKeys = schema['ui:order'] || Object.keys(schema['properties']);
      if (propertyKeys.includes('*') && !hasOwn(schema.properties, '*')) {
        const unnamedKeys = Object.keys(schema.properties)
          .filter(key => !propertyKeys.includes(key));
        for (let i = propertyKeys.length - 1; i >= 0; i--) {
          if (propertyKeys[i] === '*') {
            propertyKeys.splice(i, 1, ...unnamedKeys);
          }
        }
      }
      if (isArray(newNode.required)) {
        newNode.required.forEach(key => {
          nodeDataMap.get('requiredKeys').add(key);
          propertyKeys.push(key);
          jsf.fieldsRequired = true;
        });
      }
      propertyKeys
        .filter(key => hasOwn(schema.properties, key) ||
          hasOwn(schema, 'additionalProperties')
        )
        .forEach(key => {
          const keySchemaPointer = hasOwn(schema.properties, key) ?
            '/properties/' + key : '/additionalProperties';
          const innerItem = buildLayoutFromSchema(
            jsf, widgetLibrary,
            dataPointer === '' && !forRefLibrary ?
              '/-' : newNode.layoutPointer + '/items/-',
            schemaPointer + keySchemaPointer,
            dataPointer + '/' + key,
            false, null, null, forRefLibrary, dataPointerPrefix
          );
          if (innerItem) {
            if (isInputRequired(schema, '/' + key)) {
              innerItem.options.required = true;
              nodeDataMap.get('requiredKeys').add(key);
              jsf.fieldsRequired = true;
            }
            newSection.push(innerItem);
          }
        });
      if (dataPointer === '' && !forRefLibrary) {
        newNode = newSection;
      } else {
        newNode.items = newSection;
      }
    }
    // TODO: Add patternProperties and additionalProperties inputs?
    // ... possibly provide a way to enter both key names and values?
    // if (isObject(schema.patternProperties)) { }
    // if (isObject(schema.additionalProperties)) { }

  } else if (newNode.dataType === 'array') {
    newNode.items = [];
    let templateArray: any[] = [];
    newNode.options.maxItems = Math.min(
      schema.maxItems || 1000, newNode.options.maxItems || 1000
    );
    newNode.options.minItems = Math.max(
      schema.minItems || 0, newNode.options.minItems || 0
    );
    if (!newNode.options.minItems && isInputRequired(jsf.schema, schemaPointer)) {
      newNode.options.minItems = 1;
    }
    if (!hasOwn(newNode.options, 'listItems')) { newNode.options.listItems = 1; }
    newNode.options.tupleItems = isArray(schema.items) ? schema.items.length : 0;
    if (newNode.options.maxItems <= newNode.options.tupleItems) {
      newNode.options.tupleItems = newNode.options.maxItems;
      newNode.options.listItems = 0;
    } else if (newNode.options.maxItems <
      newNode.options.tupleItems + newNode.options.listItems
    ) {
      newNode.options.listItems = newNode.options.maxItems - newNode.options.tupleItems;
    } else if (newNode.options.minItems >
      newNode.options.tupleItems + newNode.options.listItems
    ) {
      newNode.options.listItems = newNode.options.minItems - newNode.options.tupleItems;
    }
    if (!nodeDataMap.has('maxItems')) {
      nodeDataMap.set('maxItems', newNode.options.maxItems);
      nodeDataMap.set('minItems', newNode.options.minItems);
      nodeDataMap.set('tupleItems', newNode.options.tupleItems);
      nodeDataMap.set('listItems', newNode.options.listItems);
    }
    if (!jsf.arrayMap.has(shortDataPointer)) {
      jsf.arrayMap.set(shortDataPointer, newNode.options.tupleItems)
    }
    removable = newNode.options.removable !== false;
    let additionalItemsSchemaPointer: string = null;

    // If 'items' is an array = tuple items
    if (isArray(schema.items)) {
      newNode.items = [];
      for (let i = 0; i < newNode.options.tupleItems; i++) {
        let newItem: any;
        const itemRefPointer = removeRecursiveReferences(
          shortDataPointer + '/' + i, jsf.dataRecursiveRefMap, jsf.arrayMap
        );
        const itemRecursive = itemRefPointer !== shortDataPointer + '/' + i;

        // If removable, add tuple item layout to layoutRefLibrary
        if (removable && i >= newNode.options.minItems) {
          if (!hasOwn(jsf.layoutRefLibrary, itemRefPointer)) {
            // Set to null first to prevent recursive reference from causing endless loop
            jsf.layoutRefLibrary[itemRefPointer] = null;
            jsf.layoutRefLibrary[itemRefPointer] = buildLayoutFromSchema(
              jsf, widgetLibrary,
              itemRecursive ? '' : newNode.layoutPointer + '/items/-',
              schemaPointer + '/items/' + i,
              itemRecursive ? '' : dataPointer + '/' + i,
              true, 'tuple', true, true, itemRecursive ? dataPointer + '/' + i : ''
            );
            if (itemRecursive) {
              jsf.layoutRefLibrary[itemRefPointer].recursiveReference = true;
            }
          }
          newItem = getLayoutNode({
            $ref: itemRefPointer,
            dataPointer: dataPointer + '/' + i,
            layoutPointer: newNode.layoutPointer + '/items/-',
            recursiveReference: itemRecursive,
          }, jsf.layoutRefLibrary);
        } else {
          newItem = buildLayoutFromSchema(
            jsf, widgetLibrary,
            newNode.layoutPointer + '/items/-',
            schemaPointer + '/items/' + i,
            dataPointer + '/' + i,
            true, 'tuple', false, forRefLibrary, dataPointerPrefix
          );
        }
        if (newItem) { newNode.items.push(newItem); }
      }

      // If 'additionalItems' is an object = additional list items, after tuple items
      if (isObject(schema.additionalItems)) {
        additionalItemsSchemaPointer = schemaPointer + '/additionalItems';
      }

    // If 'items' is an object = list items only (no tuple items)
    } else if (isObject(schema.items)) {
      additionalItemsSchemaPointer = schemaPointer + '/items';
    }

    if (additionalItemsSchemaPointer) {
      const itemRefPointer = removeRecursiveReferences(
        shortDataPointer + '/-', jsf.dataRecursiveRefMap, jsf.arrayMap
      );
      const itemRecursive = itemRefPointer !== shortDataPointer + '/-';
      const itemSchemaPointer = removeRecursiveReferences(
        additionalItemsSchemaPointer, jsf.schemaRecursiveRefMap, jsf.arrayMap
      );
      // Add list item layout to layoutRefLibrary
      if (!hasOwn(jsf.layoutRefLibrary, itemRefPointer)) {
        // Set to null first to prevent recursive reference from causing endless loop
        jsf.layoutRefLibrary[itemRefPointer] = null;
        jsf.layoutRefLibrary[itemRefPointer] = buildLayoutFromSchema(
          jsf, widgetLibrary,
          itemRecursive ? '' : newNode.layoutPointer + '/items/-',
          itemSchemaPointer,
          itemRecursive ? '' : dataPointer + '/-',
          true, 'list', removable, true, itemRecursive ? dataPointer + '/-' : ''
        );
        if (itemRecursive) {
          jsf.layoutRefLibrary[itemRefPointer].recursiveReference = true;
        }
      }
      const arrayLength = Math.min(Math.max(
        itemRecursive ? 0 :
        newNode.options.tupleItems + newNode.options.listItems,
        isArray(nodeValue) ? nodeValue.length : 0
      ), newNode.options.maxItems);
      if (newNode.items.length < arrayLength) {
        for (let i = newNode.items.length; i < arrayLength; i++) {
          newNode.items.push(getLayoutNode({
            $ref: itemRefPointer,
            dataPointer: dataPointer + '/-',
            layoutPointer: layoutPointer + '/items/-',
            recursiveReference: itemRecursive,
          }, jsf.layoutRefLibrary));
        }
      }

      // If needed, add $ref item to layout
      if (newNode.options.addable !== false &&
        newNode.options.minItems < newNode.options.maxItems &&
        (newNode.items[newNode.items.length - 1] || {}).type !== '$ref'
      ) {
        let buttonText =
        ((jsf.layoutRefLibrary[itemRefPointer] || {}).options || {}).title ||
        schema.title || fixTitle(JsonPointer.toKey(dataPointer));
        if (!/^add\b/i.test(buttonText)) { buttonText = 'Add ' + buttonText; }
        newNode.items.push({
          _id: _.uniqueId(),
          arrayItem: true,
          arrayItemType: 'list',
          dataPointer: newNode.dataPointer + '/-',
          layoutPointer: newNode.layoutPointer + '/items/-',
          options: {
            listItems: newNode.options.listItems,
            maxItems: newNode.options.maxItems,
            minItems: newNode.options.minItems,
            removable: false,
            title: buttonText,
            tupleItems: newNode.options.tupleItems,
          },
          recursiveReference: itemRecursive,
          type: '$ref',
          widget: widgetLibrary.getWidget('$ref'),
          $ref: itemRefPointer,
        });
      }
    }

  } else if (newNode.dataType === '$ref') {
    const schemaRef = JsonPointer.compile(schema.$ref);
    const dataRef = JsonPointer.toDataPointer(schemaRef, jsf.schema);
    let buttonText = 'Add';
    if (newNode.options.add) {
      buttonText = newNode.options.add;
    } else if (newNode.name && !/^\d+$/.test(newNode.name)) {
      if (/^add\b/i.test(newNode.name)) {
        buttonText = fixTitle(newNode.name);
      } else {
        buttonText += ' ' + fixTitle(newNode.name);
      }

    // If newNode doesn't have a title, look for title of parent array item
    } else {
      const parentSchema =
        JsonPointer.get(jsf.schema, schemaPointer, 0, -1);
      if (hasOwn(parentSchema, 'title')) {
        buttonText += ' to ' + parentSchema.title;
      } else {
        const pointerArray = JsonPointer.parse(newNode.dataPointer);
        buttonText += ' to ' + fixTitle(pointerArray[pointerArray.length - 2]);
      }
    }
    Object.assign(newNode, {
      recursiveReference: true,
      widget: widgetLibrary.getWidget('$ref'),
      $ref: dataRef,
    });
    Object.assign(newNode.options, {
      removable: false,
      title: buttonText,
    });
    if (isNumber(JsonPointer.get(jsf.schema, schemaPointer, 0, -1).maxItems)) {
      newNode.options.maxItems =
        JsonPointer.get(jsf.schema, schemaPointer, 0, -1).maxItems;
    }

    // Add layout template to layoutRefLibrary
    if (!hasOwn(jsf.layoutRefLibrary, dataRef) ||
      !jsf.layoutRefLibrary[dataRef].recursiveReference
    ) {
      // Set to null first to prevent recursive reference from causing endless loop
      jsf.layoutRefLibrary[dataRef] = null;
      const newLayout: any = buildLayoutFromSchema(
        jsf, widgetLibrary,
        '',
        schemaRef,
        '',
        newNode.arrayItem, newNode.arrayItemType, true, true, dataPointer
      );
      if (newLayout) {
        newLayout.recursiveReference = true;
        jsf.layoutRefLibrary[dataRef] = newLayout;
      } else {
        delete jsf.layoutRefLibrary[dataRef];
      }
    }
  }
  return newNode;
}

/**
 * 'mapLayout' function
 *
 * Creates a new layout by running each element in an existing layout through
 * an iteratee. Recursively maps within array elements 'items' and 'tabs'.
 * The iteratee is invoked with four arguments: (value, index, layout, path)
 *
 * The returned layout may be longer (or shorter) then the source layout.
 *
 * If an item from the source layout returns multiple items (as '*' usually will),
 * this function will keep all returned items in-line with the surrounding items.
 *
 * If an item from the source layout causes an error and returns null, it is
 * skipped without error, and the function will still return all non-null items.
 *
 * @param {any[]} layout - the layout to map
 * @param {(v: any, i?: number, l?: any, p?: string) => any}
 *   function - the funciton to invoke on each element
 * @param {any = ''} layoutPointer - the layoutPointer to layout, inside rootLayout
 * @param {any[] = layout} rootLayout - the root layout, which conatins layout
 * @return {[type]}
 */
export function mapLayout(
  layout: any[],
  fn: (v: any, i?: number, p?: string, l?: any) => any,
  layoutPointer: string = '',
  rootLayout: any[] = layout
): any[] {
  let indexPad: number = 0;
  let newLayout: any[] = [];
  forEach(layout, (item, index) => {
    let realIndex = +index + indexPad;
    let newLayoutPointer = layoutPointer + '/' + realIndex;
    let newNode: any = copy(item);
    let itemsArray: any[] = [];
    if (isObject(item)) {
      if (hasOwn(item, 'tabs')) {
        item.items = item.tabs;
        delete item.tabs;
      }
      if (hasOwn(item, 'items')) {
        itemsArray = isArray(item.items) ? item.items : [item.items];
      }
    }
    if (itemsArray.length) {
      newNode.items = mapLayout(itemsArray, fn, newLayoutPointer + '/items', rootLayout);
    }
    newNode = fn(newNode, realIndex, newLayoutPointer, rootLayout);
    if (!isDefined(newNode)) {
      indexPad--;
    } else {
      if (isArray(newNode)) { indexPad += newNode.length - 1; }
      newLayout = newLayout.concat(newNode);
    }
  });
  return newLayout;
};

/**
 * 'getLayoutNode' function
 * Copy a new layoutNode from layoutRefLibrary
 *
 * @param {any} refNode -
 * @param {any} layoutRefLibrary -
 * @return {any} copied layoutNode
 */
export function getLayoutNode(refNode: any, layoutRefLibrary: any) {
  const newLayoutNode = _.cloneDeep(layoutRefLibrary[refNode.$ref]);
  JsonPointer.forEachDeep(newLayoutNode, (subNode, pointer) => {

    // Reset all _id's in newLayoutNode to unique values
    if (hasOwn(subNode, '_id')) { subNode._id = _.uniqueId(); }

    // If adding a recursive item, prefix current dataPointer
    // and layoutPointer to all pointers in new layoutNode
    if (refNode.recursiveReference) {
      if (hasOwn(subNode, 'dataPointer')) {
        subNode.dataPointer = refNode.dataPointer + subNode.dataPointer;
      }
      if (hasOwn(subNode, 'layoutPointer')) {
        subNode.layoutPointer = refNode.layoutPointer.slice(0, -2) + subNode.layoutPointer;
      }
    }
  });
  return newLayoutNode;
}

/**
 * 'buildTitleMap' function
 *
 * @param {any} titleMap -
 * @param {any} enumList -
 * @param {boolean = true} fieldRequired -
 * @param {boolean = true} flatList -
 * @return { { name: string, value: any }[] }
 *   || { { group: string, items: { name: string, value: any }[] }[] }
 */
export function buildTitleMap(
  titleMap: any, enumList: any, fieldRequired: boolean = true, flatList: boolean = true
): TitleMapItem[] {
  let newTitleMap: TitleMapItem[] = [];
  let hasEmptyValue = false;
  if (titleMap) {
    if (isArray(titleMap)) {
      if (enumList) {
        for (let i of Object.keys(titleMap)) {
          if (isObject(titleMap[i])) { // JSON Form style
            const value: any = titleMap[i].value;
            if (enumList.includes(value)) {
              const name: string = titleMap[i].name;
              newTitleMap.push({ name, value });
              if (value === undefined || value === null) { hasEmptyValue = true; }
            }
          } else if (isString(titleMap[i])) { // React Jsonschema Form style
            if (i < enumList.length) {
              const name: string = titleMap[i];
              const value: any = enumList[i];
              newTitleMap.push({ name, value });
              if (value === undefined || value === null) { hasEmptyValue = true; }
            }
          }
        }
      } else { // If array titleMap and no enum list, just return the titleMap - Angular Schema Form style
        newTitleMap = titleMap;
        if (!fieldRequired) {
          hasEmptyValue = !!newTitleMap
            .filter(i => i.value === undefined || i.value === null)
            .length;
        }
      }
    } else if (enumList) { // Alternate JSON Form style, with enum list
      for (let i of Object.keys(enumList)) {
        let value: any = enumList[i];
        if (hasOwn(titleMap, value)) {
          let name: string = titleMap[value];
          newTitleMap.push({ name, value });
          if (value === undefined || value === null) { hasEmptyValue = true; }
        }
      }
    } else { // Alternate JSON Form style, without enum list
      for (let value of Object.keys(titleMap)) {
        let name: string = titleMap[value];
        newTitleMap.push({ name, value });
        if (value === undefined || value === null) { hasEmptyValue = true; }
      }
    }
  } else if (enumList) { // Build map from enum list alone
    for (let i of Object.keys(enumList)) {
      let name: string = enumList[i];
      let value: any = enumList[i];
      newTitleMap.push({ name, value});
      if (value === undefined || value === null) { hasEmptyValue = true; }
    }
  } else { // If no titleMap and no enum list, return default map of boolean values
    newTitleMap = [ { name: 'True', value: true }, { name: 'False', value: false } ];
  }

  // Does titleMap have groups?
  if (newTitleMap.some(title => hasOwn(title, 'group'))) {
    hasEmptyValue = false;

    // If flatList = true, flatten items & update name to group: name
    if (flatList) {
      newTitleMap = newTitleMap.reduce((groupTitleMap, title) => {
        if (hasOwn(title, 'group')) {
          if (isArray(title.items)) {
            groupTitleMap = [
              ...groupTitleMap,
              ...title.items.map(item =>
                ({ ...item, ...{ name: `${title.group}: ${item.name}` } })
              )
            ];
            if (title.items.some(item => item.value === undefined || item.value === null)) {
              hasEmptyValue = true;
            }
          }
          if (hasOwn(title, 'name') && hasOwn(title, 'value')) {
            title.name = `${title.group}: ${title.name}`;
            delete title.group;
            groupTitleMap.push(title);
            if (title.value === undefined || title.value === null) {
              hasEmptyValue = true;
            }
          }
        } else {
          groupTitleMap.push(title);
          if (title.value === undefined || title.value === null) {
            hasEmptyValue = true;
          }
        }
        return groupTitleMap;
      }, []);

    // If flatList = false, combine items from matching groups
    } else {
      newTitleMap = newTitleMap.reduce((groupTitleMap, title) => {
        if (hasOwn(title, 'group')) {
          if (title.group !== (groupTitleMap[groupTitleMap.length - 1] || {}).group) {
            groupTitleMap.push({ group: title.group, items: title.items || [] });
          }
          if (hasOwn(title, 'name') && hasOwn(title, 'value')) {
            groupTitleMap[groupTitleMap.length - 1].items
              .push({ name: title.name, value: title.value });
            if (title.value === undefined || title.value === null) {
              hasEmptyValue = true;
            }
          }
        } else {
          groupTitleMap.push(title);
          if (title.value === undefined || title.value === null) {
            hasEmptyValue = true;
          }
        }
        return groupTitleMap;
      }, []);
    }
  }
  if (!fieldRequired && !hasEmptyValue) {
    newTitleMap.unshift({ name: '<em>None</em>', value: null });
  }
  return newTitleMap;
}
