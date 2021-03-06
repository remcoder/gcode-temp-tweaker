# GCode temp tweaker

Sometimes, layers are so small that they need to be printed more slowly so the layer has time to cool down. But slowing down the feedrate causes the filament to be cooked inside the nozzle. This tool will process the gcode, calculate the overall volumetric flow rate per layer and adjust the temp accordingy. This is achieved by injecting temp commands (M104) in to the gcode. 

## How it works
 - go to https://gcode-temp-tweaker.firebaseapp.com/
 - drop a gcode file into the rectangular box
 <img width="612" alt="image" src="https://user-images.githubusercontent.com/461650/172624191-a7f24f72-d9a5-4b97-9f4a-d44515d9a692.png">
 - set the minimum and maximum temp you want to vary between
<img width="385" alt="image" src="https://user-images.githubusercontent.com/461650/172624959-842126b1-8eb3-4b4e-afa5-375a260b4f0d.png">

 - notice the table that reports the temp changes that will be injected
 <img width="579" alt="image" src="https://user-images.githubusercontent.com/461650/172625205-a571b3b8-7054-458b-9f69-968f9cc93a9d.png">

 - download the resulting gcode!


## Know issues
 - the absolute extrusion speed are off (but the resulting temp changes, which are based on relative speed changes, are surely usable)

## Running locally

Install the dependencies...

```bash
npm install
```

...then start [Rollup](https://rollupjs.org):

```bash
npm run dev
```

Navigate to [localhost:5000](http://localhost:5000). You should see your app running. 

By default, the server will only respond to requests from localhost. To allow connections from other computers, edit the `sirv` commands in package.json to include the option `--host 0.0.0.0`.



## Building and running in production mode

To create an optimised version of the app:

```bash
npm run build
```

You can run the newly built app with `npm run start`. This uses [sirv](https://github.com/lukeed/sirv), which is included in your package.json's `dependencies` so that the app will work when you deploy to platforms like [Heroku](https://heroku.com).


## Single-page app mode

By default, sirv will only respond to requests that match files in `public`. This is to maximise compatibility with static fileservers, allowing you to deploy your app anywhere.

If you're building a single-page app (SPA) with multiple routes, sirv needs to be able to respond to requests for *any* path. You can make it so by editing the `"start"` command in package.json:

```js
"start": "sirv public --single"
```

## Using TypeScript

This template comes with a script to set up a TypeScript development environment, you can run it immediately after cloning the template with:

```bash
node scripts/setupTypeScript.js
```

Or remove the script via:

```bash
rm scripts/setupTypeScript.js
```

## Deploying to the web

### With [Vercel](https://vercel.com)

Install `vercel` if you haven't already:

```bash
npm install -g vercel
```

Then, from within your project folder:

```bash
cd public
vercel deploy --name my-project
```

### With [surge](https://surge.sh/)

Install `surge` if you haven't already:

```bash
npm install -g surge
```

Then, from within your project folder:

```bash
npm run build
surge public my-project.surge.sh
```
