# Changelog

## [1.3.1](https://github.com/hjmsano/frostpillar-db/compare/v1.3.0...v1.3.1) (2026-07-14)


### Bug Fixes

* assert the collection is open in watch() ([aea9800](https://github.com/hjmsano/frostpillar-db/commit/aea98008af2e851a2de4703466287d1f8500c4de))
* cap the optional quantifiers a $regex pattern may contain ([d14a5b0](https://github.com/hjmsano/frostpillar-db/commit/d14a5b0a9d00d6e1ffa2376692673c94bcb0a8df))
* clone aggregation results out of storage ([799a3b6](https://github.com/hjmsano/frostpillar-db/commit/799a3b627f08248ec3f0b880ca89965287ee16a5))
* close every datastore when one close() fails ([dc57bfb](https://github.com/hjmsano/frostpillar-db/commit/dc57bfba1d51a8b14eac68af36a41c874d78862d))
* close input snapshot and regex review gaps ([197008a](https://github.com/hjmsano/frostpillar-db/commit/197008a69bd4ae71383aa4e8dced24ff07e387c5))
* count generated _id/_createdAt against the insert payload limits ([3d451ea](https://github.com/hjmsano/frostpillar-db/commit/3d451ea7e0d7fea8a76ff89c6b49a1601c8b5813))
* cumulative input-isolation, validation-hardening, and lifecycle fixes ([549117c](https://github.com/hjmsano/frostpillar-db/commit/549117cf98f584e4ec112d0702f96f53fdb9c197))
* deep-copy caller input on every write path ([d74a06c](https://github.com/hjmsano/frostpillar-db/commit/d74a06c420c86a68f3eb57ae33b3682353091792))
* derive driver namespaces with collectionNamespace() ([8f8a469](https://github.com/hjmsano/frostpillar-db/commit/8f8a4690a295d9b01484f19da27563a921a079f5))
* enforce the operand size limit on the _id $in fast path ([8b2fc22](https://github.com/hjmsano/frostpillar-db/commit/8b2fc22f0f5c8e698a8c0503bdd62b956035af12))
* isolate durable driver namespaces per collection ([ca613bb](https://github.com/hjmsano/frostpillar-db/commit/ca613bbcf9fd5673de1b8b82d895b9e6b9704bc0))
* keep _id identity independent of custom key normalization ([5644fc4](https://github.com/hjmsano/frostpillar-db/commit/5644fc44ce6ff4cd84fc236775ac4eea2558d87e))
* keep insertMany's storage and watch stream consistent ([1503f62](https://github.com/hjmsano/frostpillar-db/commit/1503f62cecb87f9d2034bef299e99a254b38be19))
* keep object-valued implicit equality in upsert documents ([71351bd](https://github.com/hjmsano/frostpillar-db/commit/71351bd77be54e91fab6a51fecf3444ea2b97389))
* make ids() duplicate-consistent under duplicateKeys: 'allow' ([ac4ecf0](https://github.com/hjmsano/frostpillar-db/commit/ac4ecf0128696e4c779dfb0f967c4571c82a88b4))
* read every caller input exactly once (ADR-030) ([0eac082](https://github.com/hjmsano/frostpillar-db/commit/0eac0825133cfa64c5af6fe74052ff74b7e70788))
* reclaim expired ttl conflicts ([0ea1566](https://github.com/hjmsano/frostpillar-db/commit/0ea15663e8a6612faf26471f375aeef58183344f))
* reject DEL (\x7f) in _id validation ([b3685cb](https://github.com/hjmsano/frostpillar-db/commit/b3685cb9545f74bd23fc4f97754ca61deedaf82a))
* reject non-plain objects at document and filter boundaries ([3adfcd4](https://github.com/hjmsano/frostpillar-db/commit/3adfcd4408c2c2988a48d4e603aae75f4d25aaf0))
* reject non-plain objects in the security-only payload traversal ([d536c36](https://github.com/hjmsano/frostpillar-db/commit/d536c368f458df96aeebc8c2629f3ba35ffdbec1))
* reject non-plain update operations with ValidationError ([857e357](https://github.com/hjmsano/frostpillar-db/commit/857e3574d04937b72e373d8d2c12b2bf0f36b066))
* require the $count accumulator operand to be true ([7954dcf](https://github.com/hjmsano/frostpillar-db/commit/7954dcf3877a7f9200adb0a0437b1a6533ba6181))
* validate filter structure exhaustively, independent of documents ([f2ec567](https://github.com/hjmsano/frostpillar-db/commit/f2ec567d819ba9b0e555fc4df68cbd8164b5d042))
* validate groupBy accumulator output names ([aa29f41](https://github.com/hjmsano/frostpillar-db/commit/aa29f41782b0e56864655526a220c61ae804d8e5))


### Performance Improvements

* bound and memoize groupBy accumulator work ([8d39ba0](https://github.com/hjmsano/frostpillar-db/commit/8d39ba0dec536195970e212a8b23548999f057c0))

## [1.3.0](https://github.com/hjmsano/frostpillar-db/compare/v1.2.0...v1.3.0) (2026-07-11)


### Features

* add $push and $addToSet groupBy accumulators ([3e5475b](https://github.com/hjmsano/frostpillar-db/commit/3e5475bcef2cb5b285bbc8e7d26a635813e47764))

## [1.2.0](https://github.com/hjmsano/frostpillar-db/compare/v1.1.0...v1.2.0) (2026-07-11)


### Features

* add countDistinct terminal and $countDistinct accumulator ([7ba68f4](https://github.com/hjmsano/frostpillar-db/commit/7ba68f4f423fbda68f3398ec28e350f022f9419b))
* add countDistinct terminal and $countDistinct accumulator ([deb3067](https://github.com/hjmsano/frostpillar-db/commit/deb30674cd634038c56d9994017eb6bbef16c656))

## [1.1.0](https://github.com/hjmsano/frostpillar-db/compare/v1.0.0...v1.1.0) (2026-07-11)


### Features

* add $first and $last groupBy accumulators ([fdfece2](https://github.com/hjmsano/frostpillar-db/commit/fdfece25ded074e3e36ed1c0f69a2cb225a60ddf))
* add $first and $last groupBy accumulators ([6514331](https://github.com/hjmsano/frostpillar-db/commit/65143317f39e94eff2ee7d49d69f7ecf738c58c3))

## [1.0.0](https://github.com/hjmsano/frostpillar-db/compare/v0.3.0...v1.0.0) (2026-07-11)


### ⚠ BREAKING CHANGES

* distinct() and groupBy() now order their input by a preceding .sort() when present (previously always storage order). Ordering only changes; the set of values and group contents are unchanged. Remove the .sort() to keep storage order.

### Features

* honor chain .sort() in distinct and groupBy aggregation ([e35ce17](https://github.com/hjmsano/frostpillar-db/commit/e35ce17dc9687fbe7f23f9e7a40f4cd18cecc41d))

## [0.3.0](https://github.com/hjmsano/frostpillar-db/compare/v0.2.0...v0.3.0) (2026-07-11)


### Features

* add standard deviation and variance aggregation ([eccece7](https://github.com/hjmsano/frostpillar-db/commit/eccece72a4ddbf8295cd457e87ca37a7b7afb457))
* add standard deviation and variance aggregation ([ea5e23a](https://github.com/hjmsano/frostpillar-db/commit/ea5e23a41c180c16917c5fa245506825db8e7b87))

## [0.2.0](https://github.com/hjmsano/frostpillar-db/compare/v0.1.0...v0.2.0) (2026-07-11)


### Features

* add percentile and median aggregation ([19d7d4d](https://github.com/hjmsano/frostpillar-db/commit/19d7d4d296c4ffc96a13c3c83756779100c838fe))
* add percentile and median aggregation ([ab179dd](https://github.com/hjmsano/frostpillar-db/commit/ab179dd9c0d33a035f23e87ff9a606c0c993745f))


### Bug Fixes

* simplify percentile terminal API ([08d59e0](https://github.com/hjmsano/frostpillar-db/commit/08d59e0a05b038462924d5ebb308989eeab12067))

## [0.1.0](https://github.com/hjmsano/frostpillar-db/compare/v0.0.3...v0.1.0) (2026-07-11)


### Features

* support multi-dimension groupBy with composite keys ([066b8e6](https://github.com/hjmsano/frostpillar-db/commit/066b8e699e9abe907d7a754ba59cb9f571b973e4))
* support multi-dimension groupBy with composite keys ([9a47fab](https://github.com/hjmsano/frostpillar-db/commit/9a47fabb10b52dea521aebe79b5b781a2be9bdbb))

## [0.0.3](https://github.com/hjmsano/frostpillar-db/compare/v0.0.2...v0.0.3) (2026-07-04)


### Bug Fixes

* add publishConfig and update issue template for scoped package ([b1be16f](https://github.com/hjmsano/frostpillar-db/commit/b1be16f2e0df64789161f1a283400c7896c90a11))
* Rename npm package scope and publish settings ([8e524fc](https://github.com/hjmsano/frostpillar-db/commit/8e524fc09b898e357d460693a4e81629b49c73f2))
* scope npm package under [@frostpillar](https://github.com/frostpillar) organization ([d5e74f9](https://github.com/hjmsano/frostpillar-db/commit/d5e74f969261afe79bd581eec65edcfba9badbad))
* update npm badge references to scoped package name ([6d4a084](https://github.com/hjmsano/frostpillar-db/commit/6d4a0840b7a2fa75bb1837636ee9c6440283a8e7))

## [0.0.2](https://github.com/hjmsano/frostpillar-db/compare/v0.0.1...v0.0.2) (2026-07-04)


### Bug Fixes

* **filter:** $regex screening — group-syntax '?' false positive + brace-quantified alternation gap ([f04fc02](https://github.com/hjmsano/frostpillar-db/commit/f04fc02d41b04f31575c3f49b1579140f7fe1ecf))
* **filter:** reject alternation groups hidden by a redundant wrapping group ([63ed2b9](https://github.com/hjmsano/frostpillar-db/commit/63ed2b943a79e2c1c2be278640743ef38c7515d9))
* **filter:** reject alternation groups repeated via brace quantifiers ([4b084d3](https://github.com/hjmsano/frostpillar-db/commit/4b084d3268a06cd7109070bc1bd440e7419d9d0f))
* **filter:** stop treating group-syntax '?' as a quantifier in $regex screening ([ded7b1f](https://github.com/hjmsano/frostpillar-db/commit/ded7b1fe9fb0fc6a44bc00d983aa89b9f5992d59))
* **query:** stop recommending cursor() for oversized result sets ([74afff7](https://github.com/hjmsano/frostpillar-db/commit/74afff7c750c58ecc0fefbef1e7587dd52abc58a))
* **query:** stop recommending cursor() for oversized result sets ([58b6c0c](https://github.com/hjmsano/frostpillar-db/commit/58b6c0cc7af7cf849b320c0b84ca23d6ae76f657))
