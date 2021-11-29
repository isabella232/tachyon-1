const Table = require('cli-table');
const Filesize = require('filesize');
const tachyon = require('../index');
const fs = require('fs');
const ssim = require('ssim.js');
const canvas = require('canvas');

let images = fs.readdirSync( __dirname + '/images' );

const args = process.argv.slice(2);

if ( args[0] && args[0].indexOf( '--' ) !== 0 ) {
	images = images.filter( file => args[0] === file );
}

const saveFixtured = args.indexOf( '--update-fixtures' ) > -1;

const table = new Table({
	head: [
		'Image',
		'Original Size',
		'Tachyon Size',
		'100px',
		'300px',
		'700px',
		'700px webp',
		'700px avif',
	],
	style: {
		compact: true,
	},
	colWidths: [15, 15, 20, 10, 10, 10, 15, 15],
});

// Read in existing features for resizes, so we can detect if image resizing
// has lead to a change in file size from previous runs.
const oldFixtures = JSON.parse( fs.readFileSync( __dirname + '/fixtures.json' ) );
const fixtures = {};

async function test() {
	await Promise.all(
		images.map(async imageName => {
			const image = `${__dirname}/images/${imageName}`;
			const imageData = fs.readFileSync(image);
			const sizes = {
				original: {},
				small: { w: 100 },
				medium: { w: 300 },
				large: { w: 700 },
				webp: { w: 700, webp: true },
				avif: { w: 700, avif: true },
			};
			const promises = await Promise.all(
				Object.entries(sizes).map(async ([size, args]) => {
					return Promise.all([
						tachyon.resizeBuffer(imageData, {...args, quality: 100 } ),
						tachyon.resizeBuffer(imageData, { ...args, quality: 10 } )
					])
				})
			);

			// Zip tehm back into a size => image map.
			const resized = promises.reduce((images, imageVariants, index) => {
				images[Object.keys(sizes)[index]] = imageVariants;
				return images;
			}, {});

			// Save each one to the file system for viewing.
			Object.entries(resized).forEach(([size, imageVariants]) => {
				const imageKey = `${imageName}-${size}.${imageVariants[1].info.format == 'heif' ? 'avif' : imageVariants[1].info.format }`;
				const imageKeyQ100 = `${imageName}-${size}-q100.${imageVariants[0].info.format == 'heif' ? 'avif' : imageVariants[0].info.format }`;
				fixtures[ imageKey ] = imageVariants[1].data.length;
				fs.writeFile( `${__dirname}/output/${imageKey}`, imageVariants[1].data, () => {});
				fs.writeFile( `${__dirname}/output/${imageKeyQ100}`, imageVariants[0].data, () => {});
			});

			async function itemToimageData( item ) {
				const img = await canvas.loadImage(item.data);
				const c = canvas.createCanvas(img.width, img.height);
				const ctx = c.getContext("2d");
				ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, img.width, img.height);
				return ctx.getImageData(0, 0, img.width, img.height);
			}
			async function quality_diff( item ) {
				return `(SSIM ${ ssim.ssim( await itemToimageData( item[0] ), await itemToimageData( item[1] ) ).mssim })`;
			}

			table.push([
				imageName,
				`${ Filesize(imageData.length, { round: 0 }) }`,
				Filesize(resized.original[1].info.size, { round: 0 }) +
					' (' +
					Math.floor(resized.original[1].info.size / imageData.length * 100) +
					'%) ' + ( await quality_diff( resized.original ) ),
				Filesize(resized.small[1].info.size, { round: 0 }) + ( await quality_diff( resized.small ) ),
				Filesize(resized.medium[1].info.size, { round: 0 }) + ( await quality_diff( resized.medium ) ),
				Filesize(resized.large[1].info.size, { round: 0 }) + ( await quality_diff( resized.large ) ),
				Filesize(resized.webp[1].info.size, { round: 0 }) +
					' (' +
					Math.floor(resized.webp[1].info.size / resized.large[1].info.size * 100) +
					'%) ',
				Filesize(resized.avif[1].info.size, { round: 0 }) +
				' (' +
				Math.floor(resized.avif[1].info.size / resized.large[1].info.size * 100) +
				'%) ',
			]);

		})
	);

	if ( saveFixtured ) {
		fs.writeFileSync( __dirname + '/fixtures.json', JSON.stringify( fixtures, null, 4 ) );
	}

	console.log(table.toString());

	let exitCode = 0;
	for (const key in fixtures) {
		if ( ! oldFixtures[ key ] ) {
			exitCode = 1;
			console.error( `${ key } not found in existing fixtures.` );
		}
		if ( fixtures[ key ] > oldFixtures[ key ] ) {
			const diff = fixtures[ key ] / oldFixtures[ key ] * 100;
			exitCode = 1;
			console.error( `${ key } is larger than image in fixtures (${ fixtures[ key ] - oldFixtures[ key ] } bytes larger, ${ diff }%.)` );
		}

		if ( fixtures[ key ] < oldFixtures[ key ] ) {
			const diff = oldFixtures[ key ] / fixtures[ key ] * 100;
			console.log( `${ key } is smaller than image in fixtures (${ fixtures[ key ] - oldFixtures[ key ] } bytes smaller, ${ diff }%.)` );
		}
	}
	// Exit the script if the fixtures have changed in a negative direction. This means
	// TravisCI etc will detect the failure correctly.
	process.exit(exitCode);
}

test();
