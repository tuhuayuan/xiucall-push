SRC = $(wildcard src/*.js)
LIB = $(SRC:src/%.js=lib/%.js)
TESTS ?= $(shell ls -S `find test -type f -name "*.js" -print`)
MODE ?= connector

# unittest configs
MOCHA_OPTS = --compilers js:babel-register -s 200
TIMEOUT = 5000
REPORTER = spec

install:
	npm --registry=https://registry.npm.taobao.org install

reinstall:
	@rm -rf ./node_modules
	@$(MAKE) install

build: $(LIB)

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
		$(TESTS)
		
test: 
	@NODE_ENV=test ./node_modules/.bin/mocha \
		--reporter $(REPORTER) \
		--timeout $(TIMEOUT) \
		$(MOCHA_OPTS) \
		$(TESTS)

clean:
	@rm -rf $(LIB)

run: build
	@node lib/index.js --mode $(MODE)

.PHONY: test test-cov install reinstall clean run