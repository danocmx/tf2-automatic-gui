const request = require('request-promise');
const fs = require('fs-extra');
const getSKU = require('../utils/getSKU');


// Add the list of items
exports.addItems = async function(search, options) {
	let itemsAdded = 0;
	const items = [];
	let itemsFailed = 0;
	let failedItems = [];
	let skus = [];

	return new Promise((resolve, reject) => {
		// Remove parts / paint text for bptf markdown input and remove empty entries (blank enters)
		for (i = 0; i < search.length; i++) {
			if (search[i].indexOf('Part') > -1) {
				search[i] = search[i].split(' with ').shift();
			}
			if (search[i].indexOf(' painted ') > -1) {
				search[i] = search[i].split(' painted ').shift();
			}
			if (search[i] === '') {
				search.splice(i, 1);
				i--;
			}
		}

		getAllPriced().then(async(allPrices) => { // Why, you ask? For the glory of satan of course!
			console.log('Got all prices, continuing...');

			// First check for item names like normal, for items like "Cool Breeze", "Hot Dogger", "Vintage Tyrolean" and whatever
			// Get those skus, and remove them from the search list so it doesn't try again
			for (i = 0, list = allPrices.length; i < list; i++) {
				if (search.indexOf(allPrices[i].name) > -1) {
					skus.push(allPrices[i].sku);
					search.splice(search.indexOf(allPrices[i].name), 1);
				}
			}

			// You can .filter before .map but not .map before .filter, SAD
			const promises = search.map((searchItem) => {
				return getSKU(searchItem);
			});

			const generatedSkus = await Promise.all(promises);
			// Add the item skus that weren't already handled to the skus array
			skus = skus.concat(generatedSkus);

			const start = new Date();
			// Remove items where it failed to generate a sku
			for (i = 0; i < skus.length; i++) {
				if (skus[i] === false) {
					skus.splice(skus.indexOf(skus[i]), 1);
					itemsFailed++;
					i--;
				}
			}
			
			for (i = 0, list = allPrices.length; i < list; i++) { // Dont recalculate length every time, it wont change
				if (skus.indexOf(allPrices[i].sku) > -1) {
					if (allPrices[i].buy === null || allPrices[i].sell === null) {
						continue;
					}
					
					const item = {
						sku: allPrices[i].sku,
						enabled: true,
						autoprice: true,
						max: options.max,
						min: options.min,
						intent: options.intent,
						name: '',
						buy: {},
						sell: {},
						time: 0
					};
					item.name = allPrices[i].name;
					item.buy = allPrices[i].buy;
					item.sell = allPrices[i].sell;
					item.time = allPrices[i].time;

					// Add item to items array, these will be used to update the pricelist and remove from skus array
					items.push(item);
					skus.splice(skus.indexOf(allPrices[i].sku), 1);
					itemsAdded++;
				}

				if (i == allPrices.length - 1) { // Done looping
					const end = new Date() - start;
					console.info('Execution time: %dms', end);
					itemsFailed += skus.length; // items that succeeded get removed from skus 
					failedItems = skus; // so all thats left in skus is failed items

					if (itemsAdded > 0) {
						addItemsToPricelist(items).then((result) => {
							if (result > 0) {
								itemsAdded -= result;
							}
							return resolve({
								itemsAdded: itemsAdded,
								itemsFailed: itemsFailed,
								alreadyAdded: result,
								failedItems: failedItems
							});
						}).catch((err) => {
							return reject(err);
						});
					} else {
						return resolve({
							itemsAdded: itemsAdded,
							itemsFailed: itemsFailed,
							failedItems: failedItems
						});
					}
				}
			}
		});
	});
};

exports.changeSingleItem = function(item) {
	return new Promise((resolve, reject) => {
		fs.readJSON('./config/pricelist.json').then((pricelist) => {
			// Get pricelist, change some stuff and save
			for (i = 0; i < pricelist.length; i++) {
				if (item.sku === pricelist[i].sku) {
					pricelist[i].buy = item.buy;
					pricelist[i].sell = item.sell;
					pricelist[i].intent = item.intent;
					pricelist[i].min = item.min;
					pricelist[i].max = item.max;
					pricelist[i].autoprice = item.autoprice;
					pricelist[i].time = item.time;
					break;
				}
			}
			return pricelist;
		}).then((pricelist) => {
			fs.writeJSON('./config/pricelist.json', pricelist).then(() => {
				return resolve(true);
			}).catch((err) => {
				return reject(err);
			});
		}).catch((err) => {
			return reject(err);
		});
	});
};


/**
 * Remove one or multiple items
 * @param {Object|Object[]} items
 * @return {Promise<number|boolean>}
 */
exports.removeItems = function(items) {
	return new Promise((resolve, reject) => {
		if (!items || items.length == 0) {
			return resolve(false);
		}

		if (!Array.isArray(items)) {
			items = [items];
		}

		removeItemsFromPricelist(items).then((result) => {
			if (!result) return resolve(false);
			return resolve(result);
		}).catch((err) => {
			return reject(err);
		});
	});
};


function addItemsToPricelist (items) {
	return new Promise((resolve, reject) => {
		let alreadyAdded = 0;
		fs.readJSON('./config/pricelist.json').then((pricelist) => {
			itemsloop:
			// for each item, check if they're already in the pricelist *while changing it too* to avoid having 2 of the same
			for (j = 0; j < items.length; j++) {
				for (i = 0; i < pricelist.length; i++) {
					if (pricelist[i].sku == items[j].sku) {
						alreadyAdded++;
						continue itemsloop;
					}
				}
				
				// Not already added, so add
				pricelist.push(items[j]);
			}
			return pricelist;
		}).then((pricelist) => {
			fs.writeJSON('./config/pricelist.json', pricelist).then(() => {
				return resolve(alreadyAdded);
			}).catch((err) => {
				throw err;
			});
		}).catch((err) => {
			return reject(err);
		});
	});
}

function removeItemsFromPricelist (items) {
	return new Promise((resolve, reject) => {
		let itemsremoved = 0;
		fs.readJSON('./config/pricelist.json').then((pricelist) => {
			for (i = 0; i < pricelist.length; i++) {
				for (j = 0; j < items.length; j++) {
					if (pricelist[i].sku == items[j]) {
						pricelist.splice(pricelist.indexOf(pricelist[i]), 1);
						itemsremoved++;
					}
				}
			}
			return pricelist;
		}).then((pricelist) => {
			fs.writeJSON('./config/pricelist.json', pricelist).then(() => {
				return resolve(itemsremoved);
			}).then((err) => {
				return reject(err);
			});
		}).catch((err) => {
			return reject(err);
		});
	});
}

// Render the pricelist with some info
exports.renderPricelist = function(res, type, msg, failedItems = []) {
	fs.readJSON('./config/pricelist.json').then((pricelist) => {
		res.render('home', {
			type: type,
			msg: msg,
			pricelist: pricelist,
			failedItems: failedItems
		});
	}).catch((err) => {
		throw err;
	});
};

exports.clear = function() {
	return fs.writeJSON('./config/pricelist.json', []);
};

function getAllPriced () {
	console.log('Getting all prices...');

	const options = {
		method: 'GET',
		json: true,
		uri: 'https://api.prices.tf/items',
		qs: {
			src: 'bptf'
		},
		json: true
	};

	if (fs.existsSync('/config/config.json')) {
		const config = require('./config/config.json');
		if (config.pricesApiToken) {
			options.headers = {
				Authorization: 'Token ' + config.pricesApiToken
			};
		}
	}

	const start = new Date();

	return request(options)
		.then(({ success, message, items }) => {
			if (!success) {
				if (message === 'Unauthorized') {
					throw new Error('Your prices.tf api token is incorrect. Join the discord here https://discord.tf2automatic.com/ and request one from Nick. Or leave it blank in the config.');
				}

				throw new Error('Couldn\'t get all prices from pricestf: ' + body);
			}

			const end = new Date() - start;
			console.info('Execution time: %dms', end);

			return items;
		});
}
