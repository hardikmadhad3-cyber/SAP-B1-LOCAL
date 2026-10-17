# Units of Measure and UoM Groups

The page maintains two separate company records, as in SAP Business One:

- **Units of Measure** (`OUOM`): the company unit list. Code is unique, up to 20 characters; name is up to 100 characters. Creating KGS adds a unit, not a group. The tab lists saved units and refreshes after both successful saves and duplicate errors.
- **UoM Groups** (`OUGP`, `UGP1`): select an existing unit as the base and define alternate-unit conversions. Group code is up to 20 characters and name up to 100 characters. Update skips unused blank rows and preserves successful rows if a later save fails.

Group Definition fixes the base row at 1 = 1. Alternate and base quantities must be positive (fractional quantities are allowed), and a unit cannot appear twice in one group. Used item units cannot be removed; the base cannot change while items use the group. Conversion changes are refused while affected units occur in open marketing documents. Failed definition reads cannot overwrite existing rows.

Example: Alternate Quantity 1, alternate UoM BOX, Base Quantity 12, base UoM EA means 1 BOX = 12 EA.

Data reloads when the active company changes. The page uses shared `im-*` styling and `SapModalShell`.

## Verification

From `backend`: `node --test --test-concurrency=1 test/localSetupMasters.test.js`.
From `frontend`: `npm test -- --watchAll=false --runInBand --runTestsByPath src/modules/uom-group-setup/UoMGroupSetup.test.jsx`.

## Official references and scope

- [SAP: units and groups](https://learning.sap.com/courses/managing-logistics-in-sap-business-one/working-with-units-of-measure-uom-in-sap-business-one)
- [SAP: conversion changes](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/1fd747565899f81ae10000000a441470.html)
- [SAP 10.0 OUOM table](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/OUOM.html)
- [SAP 10.0 OUGP table](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/OUGP.html)

Dimensions, packaging, EWB mapping, production/blanket-agreement/draft restrictions and full SAP setup parity are not implemented by this page. The local conversion guard currently checks the supported marketing-document tables.
