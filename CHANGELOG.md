# Changelog

## [0.0.2](https://github.com/hjmsano/frostpillar-db/compare/v0.0.1...v0.0.2) (2026-07-04)


### Bug Fixes

* **filter:** $regex screening — group-syntax '?' false positive + brace-quantified alternation gap ([f04fc02](https://github.com/hjmsano/frostpillar-db/commit/f04fc02d41b04f31575c3f49b1579140f7fe1ecf))
* **filter:** reject alternation groups hidden by a redundant wrapping group ([63ed2b9](https://github.com/hjmsano/frostpillar-db/commit/63ed2b943a79e2c1c2be278640743ef38c7515d9))
* **filter:** reject alternation groups repeated via brace quantifiers ([4b084d3](https://github.com/hjmsano/frostpillar-db/commit/4b084d3268a06cd7109070bc1bd440e7419d9d0f))
* **filter:** stop treating group-syntax '?' as a quantifier in $regex screening ([ded7b1f](https://github.com/hjmsano/frostpillar-db/commit/ded7b1fe9fb0fc6a44bc00d983aa89b9f5992d59))
* **query:** stop recommending cursor() for oversized result sets ([74afff7](https://github.com/hjmsano/frostpillar-db/commit/74afff7c750c58ecc0fefbef1e7587dd52abc58a))
* **query:** stop recommending cursor() for oversized result sets ([58b6c0c](https://github.com/hjmsano/frostpillar-db/commit/58b6c0cc7af7cf849b320c0b84ca23d6ae76f657))
