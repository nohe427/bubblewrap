/*
 * Copyright 2019 Google Inc. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import * as path from 'path';
import * as fs from 'fs';
import fetch from 'node-fetch';
import {template} from 'lodash';
import {promisify} from 'util';
import {TwaManifest} from './TwaManifest';
import Jimp = require('jimp');

const COPY_FILE_LIST = [
  'settings.gradle',
  'gradle.properties',
  'build.gradle',
  'gradlew',
  'gradlew.bat',
  'gradle/wrapper/gradle-wrapper.jar',
  'gradle/wrapper/gradle-wrapper.properties',
  'app/src/main/res/values/styles.xml',
  'app/src/main/res/xml/filepaths.xml',
  'app/src/main/res/xml/shortcuts.xml',
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
];

const TEMPLATE_FILE_LIST = [
  'app/build.gradle',
  'app/src/main/AndroidManifest.xml',
];

const DELETE_FILE_LIST = [
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
];

const IMAGES: IconDefinition[] = [
  {dest: 'app/src/main/res/mipmap-hdpi/ic_launcher.png', size: 72},
  {dest: 'app/src/main/res/mipmap-mdpi/ic_launcher.png', size: 48},
  {dest: 'app/src/main/res/mipmap-xhdpi/ic_launcher.png', size: 96},
  {dest: 'app/src/main/res/mipmap-xxhdpi/ic_launcher.png', size: 144},
  {dest: 'app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', size: 192},
  {dest: 'app/src/main/res/drawable-hdpi/splash.png', size: 450},
  {dest: 'app/src/main/res/drawable-mdpi/splash.png', size: 300},
  {dest: 'app/src/main/res/drawable-xhdpi/splash.png', size: 600},
  {dest: 'app/src/main/res/drawable-xxhdpi/splash.png', size: 900},
  {dest: 'app/src/main/res/drawable-xxxhdpi/splash.png', size: 1200},
  {dest: 'store_icon.png', size: 512},
];

const ADAPTIVE_IMAGES: IconDefinition[] = [
  {dest: 'app/src/main/res/mipmap-hdpi/ic_maskable.png', size: 123},
  {dest: 'app/src/main/res/mipmap-mdpi/ic_maskable.png', size: 82},
  {dest: 'app/src/main/res/mipmap-xhdpi/ic_maskable.png', size: 164},
  {dest: 'app/src/main/res/mipmap-xxhdpi/ic_maskable.png', size: 246},
  {dest: 'app/src/main/res/mipmap-xxxhdpi/ic_maskable.png', size: 328},
];

const SHORTCUT_IMAGES: IconDefinition[] = [
  {dest: 'app/src/main/res/drawable-mdpi/', size: 48},
  {dest: 'app/src/main/res/drawable-hdpi/', size: 72},
  {dest: 'app/src/main/res/drawable-xhdpi/', size: 96},
  {dest: 'app/src/main/res/drawable-xxhdpi/', size: 144},
  {dest: 'app/src/main/res/drawable-xxxhdpi/', size: 192},
];

// fs.promises is marked as experimental. This should be replaced when stable.
const fsMkDir = promisify(fs.mkdir);
const fsCopyFile = promisify(fs.copyFile);
const fsWriteFile = promisify(fs.writeFile);
const fsReadFile = promisify(fs.readFile);

interface IconDefinition {
  dest: string;
  size: number;
}

interface Icon {
  url: string;
  data: Buffer;
}

/**
 * Generates TWA Projects from a TWA Manifest
 */
export class TwaGenerator {
  // Ensures targetDir exists and copies a file from sourceDir to target dir.
  private async copyStaticFile(
      sourceDir: string, targetDir: string, filename: string): Promise<void> {
    const sourceFile = path.join(sourceDir, filename);
    const destFile = path.join(targetDir, filename);
    console.log('\t', destFile);
    await fsMkDir(path.dirname(destFile), {recursive: true});
    await fsCopyFile(sourceFile, destFile);
  }

  // Copies a list of file from sourceDir to targetDir.
  private copyStaticFiles(
      sourceDir: string, targetDir: string, fileList: string[]): Promise<void[]> {
    return Promise.all(fileList.map((file) => {
      return this.copyStaticFile(sourceDir, targetDir, file);
    }));
  }

  private async applyTemplate(
      sourceDir: string, targetDir: string, filename: string, args: object): Promise<void> {
    const sourceFile = path.join(sourceDir, filename);
    const destFile = path.join(targetDir, filename);
    console.log('\t', destFile);
    await fsMkDir(path.dirname(destFile), {recursive: true});
    const templateFile = await fsReadFile(sourceFile, 'utf-8');
    const output = template(templateFile)(args);
    await fsWriteFile(destFile, output);
  }

  private applyTemplates(
      sourceDir: string, targetDir: string, fileList: string[], args: object): Promise<void[]> {
    return Promise.all(fileList.map((file) => {
      this.applyTemplate(sourceDir, targetDir, file, args);
    }));
  }

  private async saveIcon(data: Buffer, size: number, fileName: string): Promise<void> {
    const image = await Jimp.read(data);
    await image.resize(size, size);
    await image.writeAsync(fileName);
  }

  private async generateIcon(
      iconData: Icon, targetDir: string, iconDef: IconDefinition): Promise<void> {
    const destFile = path.join(targetDir, iconDef.dest);
    console.log(`\t ${iconDef.size}x${iconDef.size} Icon: ${destFile}`);
    await fsMkDir(path.dirname(destFile), {recursive: true});
    return await this.saveIcon(iconData.data, iconDef.size, destFile);
  }

  private async generateIcons(
      iconUrl: string, targetDir: string, iconList: IconDefinition[]): Promise<void[]> {
    const icon = await this.fetchIcon(iconUrl);
    return Promise.all(iconList.map((iconDef) => {
      return this.generateIcon(icon, targetDir, iconDef);
    }));
  }

  /**
   * Fetches an Icon.
   *
   * @param {Object} iconUrl the URL to fetch the icon from.
   * @returns an Object containing the original URL and the icon image data.
   */
  private async fetchIcon(iconUrl: string): Promise<Icon> {
    const response = await fetch(iconUrl);
    const body = await response.buffer();
    return {
      url: iconUrl,
      data: body,
    };
  }

  /**
   * Creates a new TWA Project.
   *
   * @param {String} targetDirectory the directory where the project will be created
   * @param {Object} twaManifest configurations values for the project.
   */
  async createTwaProject(targetDirectory: string, twaManifest: TwaManifest): Promise<void> {
    if (!twaManifest.validate()) {
      throw new Error('Invalid TWA Manifest. Missing or incorrect fields.');
    };

    console.log('Generating Android Project files:');
    console.log(__dirname);
    const templateDirectory = path.join(__dirname, '../../template_project');

    const copyFileList = new Set(COPY_FILE_LIST);
    if (!twaManifest.maskableIconUrl) {
      DELETE_FILE_LIST.forEach((file) => copyFileList.delete(file));
    }

    // Copy Project Files
    await this.copyStaticFiles(templateDirectory, targetDirectory, Array.from(copyFileList));

    // Generate templated files
    await this.applyTemplates(
        templateDirectory, targetDirectory, TEMPLATE_FILE_LIST, twaManifest);

    // Generate images
    if (twaManifest.iconUrl) {
      await this.generateIcons(twaManifest.iconUrl, targetDirectory, IMAGES);
    }

    // TODO(andreban): TwaManifest.shortcuts is a string, which is being parsed into an Object.
    // Needs to be transformed into a proper Class.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await Promise.all(JSON.parse(twaManifest.shortcuts).map((shortcut: any, i: number) => {
      const imageDirs = SHORTCUT_IMAGES.map(
          (imageDir) => ({...imageDir, dest: `${imageDir.dest}shortcut_${i}.png`}));
      return this.generateIcons(shortcut.chosenIconUrl, targetDirectory, imageDirs);
    }));

    // Generate adaptive images
    if (twaManifest.maskableIconUrl) {
      await this.generateIcons(twaManifest.maskableIconUrl, targetDirectory, ADAPTIVE_IMAGES);
    }
  }
}
