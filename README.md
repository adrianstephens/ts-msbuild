# @isopodlabs/msbuild
[![npm version](https://img.shields.io/npm/v/@isopodlabs/msbuild.svg)](https://www.npmjs.com/package/@isopodlabs/msbuild)
[![GitHub stars](https://img.shields.io/github/stars/adrianstephens/ts-msbuild.svg?style=social)](https://github.com/adrianstephens/ts-msbuild)
[![License](https://img.shields.io/npm/l/@isopodlabs/msbuild.svg)](LICENSE)

A TypeScript library for parsing and manipulating MSBuild project files and Visual Studio solutions.

## ☕ Support My Work
If you use this package, consider [buying me a cup of tea](https://coff.ee/adrianstephens) to support future updates!

## Installation

```sh
npm install @isopodlabs/msbuild
```

## Features

### Solution Management
- **Parse Visual Studio solution files** (.sln)
- **Project discovery** - automatically detect and load referenced projects
- **Configuration management** - handle Debug/Release, platform configurations
- **Project dependencies** - track and manage inter-project references
- **Solution folders** - organize projects in virtual folders

### Project Support
- **MSBuild projects** - C#, VB.NET, F#, C++ projects
- **Modern SDK-style projects** - .NET Core/5+ projects
- **Legacy projects** - Framework 4.x and earlier
- **Specialized projects** - Android, web, deployment projects
- **Project filters** - Visual Studio filter files (.vcxproj.filters)

### Property System
- **Property evaluation** - MSBuild property expansion and substitution
- **Conditional properties** - condition-based property evaluation
- **Import resolution** - handle .props and .targets imports
- **Environment integration** - access environment variables and registry

## Usage

### Loading Solutions

```typescript
import { Solution } from '@isopodlabs/msbuild';

// Load a Visual Studio solution
const solution = await Solution.load('path/to/solution.sln');

if (solution) {
    console.log(`Loaded ${Object.keys(solution.projects).length} projects`);
    
    // Access projects
    const project = solution.projectByName('MyProject');
    
    // Get active configuration
    const config = solution.activeConfiguration;
    console.log(`Active: ${config.Configuration}|${config.Platform}`);
}
```

### Working with Projects

```typescript
// Get project configurations
const configs = project.configurationList();  // ['Debug', 'Release']
const platforms = project.platformList();     // ['x86', 'x64', 'Any CPU']

// Evaluate project properties
const [props, origins] = await project.evaluateProps({
    Configuration: 'Debug',
    Platform: 'x64'
});

console.log('Output path:', props.properties.OutputPath);
```

## API Reference

### Core Classes
- [`Solution`][Solution] - Visual Studio solution parser and manager
- [`Project`][Project] - Base project class with common functionality
- [`MsBuildProject`][MsBuildProject] - MSBuild-based projects (.csproj, .vbproj, etc.)
- [`PropertyContext`][PropertyContext] - MSBuild property evaluation engine
- [`Items`][Items] - Project item collections (files, references, etc.)

## Supported Project Types

The library recognizes and handles these Visual Studio project types:
- **C# Projects** - .csproj files (Framework and SDK-style)
- **VB.NET Projects** - .vbproj files
- **F# Projects** - .fsproj files  
- **C++ Projects** - .vcxproj files with filter support
- **Web Projects** - ASP.NET, MVC, Web API projects
- **Mobile Projects** - Xamarin Android/iOS projects
- **Deployment Projects** - Setup and deployment projects

## Advanced Features

### Expression Evaluation
Built-in support for MSBuild expressions and functions:
- Property substitution: `$(PropertyName)`
- Registry access: `$(registry:HKEY_LOCAL_MACHINE\SOFTWARE\...)`
- Static function calls: `$([System.Environment]::GetFolderPath(...))`
- Metadata access: `%(MetadataName)`
- List expressions: `@(Items)` and `@(Items->%(field))`

## License

This project is licensed under the MIT License.

<!-- Type References -->
[Solution]: https://github.com/adrianstephens/ts-msbuild/blob/HEAD/src/Solution.ts#L283
[Project]: https://github.com/adrianstephens/ts-msbuild/blob/HEAD/src/Project.ts#L123
[MsBuildProject]: https://github.com/adrianstephens/ts-msbuild/blob/HEAD/src/MsBuild.ts#L1044
[PropertyContext]: https://github.com/adrianstephens/ts-msbuild/blob/HEAD/src/MsBuild.ts#L28
[Items]: https://github.com/adrianstephens/ts-msbuild/blob/HEAD/src/MsBuild.ts#L340
