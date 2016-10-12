SRC = $(wildcard src/*.js)
LIB = $(SRC:src/%.js=lib/%.js)
FUNCTESTS ?= $(shell ls -S `find test/functests -type f -name "*.js" -print`)
UNITTESTS ?= $(shell ls -S `find test/unittests -type f -name "*.js" -print`)
MODE ?= connector

# unittest configs
MOCHA_OPTS = --compilers js:babel-register -s 1000
TIMEOUT = 5000
REPORTER = spec

install:
	npm --registry=https://registry.npm.taobao.org install

uninstall:
	@rm -rf ./node_modules

build: $(LIB)
	@mkdir -p ./bin
	@cp -f ./lib/index.js ./bin/xiucall-push

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
	@rm -rf ./bin/*

run: build
	@node lib/index.js --mode $(MODE)

.PHONY: test test-unit test-func test-cov install reinstall clean run