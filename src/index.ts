import * as fs from 'fs';
import * as utils from '@isopodlabs/utilities';
import * as xml from '@isopodlabs/xml';

export { Version, version_compare } from './Version';
export { Items, Origins, Project, PropertyContext, ItemMode, XMLProjectItemEntry, addPropertySetting, evaluateImport, evaluatePropsAndImports } from './MsBuild';
export * as Locations from './Locations';


//-----------------------------------------------------------------------------
//	xml helpers
//-----------------------------------------------------------------------------

export async function xml_load(filename : string) : Promise<xml.Element | undefined> {
	return fs.promises.readFile(filename, "utf-8").then(content	=> content ? xml.parse(content) : undefined);
}

export async function xml_save(filename : string, element: xml.Element) : Promise<void> {
	return fs.promises.writeFile(filename, element.toString()).catch(error => {
		console.log(`Failed to save ${filename} : ${error}`);
	});
}

export const XMLCache	= utils.makeCache(xml_load);
