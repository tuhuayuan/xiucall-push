SRC = $(wildcard src/*.js)
LIB = $(SRC:src/%.js=lib/%.js)
FUNCTESTS ?= $(shell ls -S `find test/functests -type f -name "*.js" -print`)
UNITTESTS ?= $(shell ls -S `find test/unittests -type f -name "*.js" -print`)
MODE ?= connector
NPM_REGISTRY ?= "--registry=http://registry.npm.taobao.org"

# unittest configs
MOCHA_OPTS = --compilers js:babel-register -s 1000
TIMEOUT = 5000
REPORTER = spec

pre-build:
	npm $(NPM_REGISTRY) install

uninstall:
	@rm -rf ./node_modules

build: pre-build $(LIB)

lib/%.js: src/%.js .babelrc
	mkdir -p $(@D)
	./node_modules/.bin/babel $< -o $@

test-cov: 
	@NODE_ENV=test ./node_modules/.bin/babel-node \
	  ./node_modules/.bin/babel-istanbul cover \
		./node_modules/.bin/_mocha -- \
		--reporter $(REPORTER) \
		--timeout $(TIMEOUT) \
		$(MOCHA_OPTS) \
		$(FUNCTESTS) $(UNITTESTS)
		
test: test-unit test-func

test-unit:
	@NODE_ENV=test ./node_modules/.bin/mocha \
	  -r ./test/entry.js \
		--reporter $(REPORTER) \
		$(MOCHA_OPTS) \
		$(UNITTESTS)

test-func:
	@NODE_ENV=test ./node_modules/.bin/mocha \
	  -r ./test/entry.js \
		--reporter $(REPORTER) \
		--timeout $(TIMEOUT) \
		$(MOCHA_OPTS) \
		$(FUNCTESTS)

clean:
	@rm -rf $(LIB)
	@rm -rf ./coverage

run: build
	@node lib/index.js --mode $(MODE)

.PHONY: test test-unit test-func test-cov pre-build uninstall clean run