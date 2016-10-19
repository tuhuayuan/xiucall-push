import should from 'should'

/**
 * Example of UnhandledPromiseRejectionWarning.
 */
async function work() {
  console.log('create job1');
  let job1 = new Promise((fulfill, reject) => {
    setTimeout(reject, 1000);
  }).catch(err => {
    console.log('job2 reject job1.');
    throw err; // 这个异常抛出后没有及时处理要等到最后await job1才能被调用work的地方catch。
  });
  console.log('create job2');
  await new Promise((fulfill, reject) => {
    setTimeout(fulfill, 2000);
  });
  console.log('wait job1');
  job1.should.be.rejected()
  await job1;
  await 'ok';
}

work().catch(err => {
  console.log(`worke errror ${err}`);
});