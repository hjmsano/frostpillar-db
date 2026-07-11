# Changelog

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
