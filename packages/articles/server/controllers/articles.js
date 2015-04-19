'use strict';
var azure = require('azure-storage');
var pg = require('pg');
var request = require('request');
var parseString = require('xml2js').parseString;
var conString = 'postgres://' + process.env.POSTGRES + '/postgres';
var retryOperations = new azure.ExponentialRetryPolicyFilter();
var blobSvc = azure.createBlobService().withFilter(retryOperations);

blobSvc.createContainerIfNotExists('userpictures', {publicAccessLevel: 'blob'}, function(error, result, response) {
  if (!error) {
    console.log(result);
    console.log(response);
  } else {
    console.log('error creating azure blob container ', error);
  }
});

/**
 * Returns tree data for a single tree (profile view). Function expects a treeid.
 * @param req
 * @param res
 */
exports.getTreeData = function(req, res) {
  var treeid = req.params.treeId;
  pg.connect(conString, function(err, client, done) {
    var selectMessages = 'SELECT tree.name, tree.treeid, q.qspecies, tree.plotsize, tree.qcaretaker, tree.plantdate, l.latitude, l.longitude, image.imageurl, image.imagewidth, image.imageheight, image.imagetype from qspecies q JOIN tree ON (q.qspeciesid = tree.qspeciesid) JOIN "location" l ON (l.locationid = tree.locationid) "JOIN" image ON (q.qspeciesid = image.qspeciesid) WHERE treeid = $1;';
    client.query(selectMessages, [treeid], function(error, results) {
      console.log(selectMessages);
      if (error) {
        console.log(error, 'THERE WAS AN ERROR');
      } else {
        res.json(results.rows[0]);
      }
      done();
    });
  });
};

/**
 * Get tree data for 250 trees (list view).
 * @param req
 * @param res
 */
exports.getAll = function(req, res) {
  pg.connect(conString, function(err, client, done) {
    // console.log(err);
    var selectTrees = 'SELECT tree.name, tree.treeid, q.qspecies, l.latitude, l.longitude, image.imageurl as url, image.imagewidth, image.imageheight, image.imagetype FROM qspecies q JOIN tree ON (q.qspeciesid = tree.qspeciesid) JOIN "location" l ON (l.locationid = tree.locationid) JOIN "image" ON (q.qspeciesid = image.qspeciesid) LIMIT 250;';
    client.query(selectTrees, function(error, results) {
    }, function(error, results) {
      done();
      if (error) {
        console.log('Error is ', error);
      }
      res.json(results.rows);
    });
  });
};

/**
 * Gets tree's messages from database and sends it to client. Request is expecting a treeId.
 * @param req
 * @param res
 */
exports.getMessagesForTree = function(req, res) {
  var treeid = req.params.treeid;
  // console.log('in getMessageForTree and treeid is', treeid);
  pg.connect(conString, function(err, client, done) {
    console.log(err);
    var selectMessages = 'SELECT message.message, message.treeid, message.username, message.messageid, message.createdAt FROM message  WHERE treeid = $1 LIMIT 100;';
    client.query(selectMessages, [treeid], function(error, results) {
      res.json(results.rows);
    });
    done();
  });
};

/**
 * Gets messages from users and sends it to the database. Request is expecting an username.
 * @param req
 * @param res
 */
exports.getMessagesForUsers = function(req, res) {
  var username = req.params.userid;
  // console.log('in getMessageForUsers and username is', username);
  pg.connect(conString, function(err, client, done) {
    console.log(err);
    var selectMessages = 'SELECT message.message, message.treeid, tree.name, message.username, message.messageid, message.createdAt FROM message JOIN tree ON (tree.treeid = message.treeid) WHERE username = $1 LIMIT 100;';
    client.query(selectMessages, [username], function(error, results) {
      console.log('error is ', error);
      res.json(results.rows);
    });
    done();
  });
};

/**
 * Gets messages from both users or trees and uploads them to the database. Request expecting treeName or userName,
 * and a treeId.
 * @param req
 * @param res
 */
//
exports.postMessageFromUser = function(req, res) {
  console.log('got into postMessageFromUser');
  var username = req.body.username;
  var message = req.body.message;
  var treeid = req.body.treeid;
  var returnMessages = [];
  var url = 'http://www.botlibre.com/rest/botlibre/form-chat?application=' + process.env.APPLICATIONID + '&message=' + message + '&instance=812292';
  request(url, function(error, response, body) {
    console.log('body', body);
    if (!error && response.statusCode === 200) {
      parseString(body, function(error, result) {
        pg.connect(conString, function(err, client, done) {
          if (err) {
            console.log('error is', err);
          }
          else {
            var insertMessages = 'INSERT INTO message (message, username, treeid, createdat) values ($1, $2, $3, now()) RETURNING *;';
            client.query(insertMessages, [message, username, treeid], function(error, results) {
              returnMessages.push(results.rows[0]);
              done();
            });
            var insertTreeMessages = 'INSERT INTO message (message, username, treeid, createdat) values ($1, $2, $3, now()) RETURNING *;';
            client.query(insertTreeMessages, [result.response.message[0], 'unknown', treeid], function(error, results) {
              // console.log(error);
              returnMessages.push(results.rows[0]);
              res.send(returnMessages);
              done();
            });
          }
        });

      });
    }
  });
};

/**
 * Search tree return 250 results matching the search params. It takes a search param, and an offset. If offset is not
 * provided it will default to 0.
 * @param req
 * @param res
 */
exports.searchTrees = function(req, res) {
  var search = req.params.search;
  search = search.replace('%20', ' ');
  var offset = req.offset || 0;
  var searchString = typeof search === 'string' ? '%' + search + '%' : 'do not use';
  var searchNum = typeof search === 'number' ? search : 0;
  pg.connect(conString, function(err, client, done) {
    console.log('in search trees');
    // console.log(err);
    var selectTrees = 'SELECT tree.name, tree.treeid, q.qspecies, l.latitude, l.longitude, image.imageurl, image.imagewidth, image.imageheight, image.imagetype FROM qspecies q JOIN tree ON (q.qspeciesid = tree.qspeciesid) JOIN "location" l ON (l.locationid = tree.locationid) JOIN "image" ON (q.qspeciesid = image.qspeciesid) WHERE ' +
      'tree.treeid = $1 OR tree.name LIKE $2 OR q.qspecies LIKE $2 OR q.qspeciesid = $1 LIMIT 250 OFFSET $3;';

    // var selectTrees = 'SELECT tree.name, q.qspecies, l.latitude, l.longitude, thumbnail.url, thumbnail.width, ' +
    //   'thumbnail.height, thumbnail.contenttype FROM qspecies q JOIN tree ON (q.qspeciesid = tree.qspeciesid) JOIN ' +
    //   '"location" l ON (l.locationid = tree.locationid) JOIN thumbnail ON (q.qspeciesid = thumbnail.qspeciesid) WHERE ' +
    //   'tree.treeid = $1 OR tree.name LIKE $2 OR q.qspecies LIKE $2 OR q.qspeciesid = $1 LIMIT 250 OFFSET $3;';
    console.log(searchNum, searchString, offset);
    client.query(selectTrees, [searchNum, searchString, offset], function(error, results) {
      // console.log('error', error);
      //console.log('results', results);
      console.log(results.rows);
      res.json(results.rows);
    });
    done();
  });
};

/**
 * This function expects a treeid to insert messages. The userid will be saved with the value of -1 which means that
 * the message was sent by the tree.
 * @param req
 * @param res
 */
exports.insertMessagesFromTrees = function(req, res) {
  console.log('got into insertMessagesFromTrees is ');
  var treeid = req.body.treeid;
  var userid = -1;
  var message = req.body.message;
  // console.log(treeid, userid, message);
  pg.connect(conString, function(err, client, done) {
    // console.log(err);
    var selectMessages = 'INSERT INTO message (message, treeid, userid, createdat) values($1, $2, $3, now())';
    client.query(selectMessages, [message, treeid, userid], function(error, results) {
      // console.log('results is ', results);
      res.send(results);
      done();
    });
  });
};

/**
 * Inserts likes into database. This takes username and treeid.
 * @param req
 * @param res
 */
exports.insertLikes = function(req, res) {
  var treeid = req.body.treeId;
  var username = req.body.username;
  pg.connect(conString, function(err, client, done) {
    // console.log(err);
    var insertLikes = 'INSERT INTO likes (username, treeid) values($1, $2)';
    client.query(insertLikes, [username, treeid], function(error, results) {
      // console.log('results is ', results);
      res.send(results);
      done();
    });
  });
};

/**
 * This gets a list of trees that the user likes. It takes an username.
 * @param req
 * @param res
 */
exports.getTreeLikes = function(req, res) {
  var username = req.body.username;
  pg.connect(conString, function(err, client, done) {
    var selectLikes = 'SELECT tree.name, tree.treeid, q.qspecies, thumbnail.url, thumbnail.width, thumbnail.height, ' +
      'thumbnail.contenttype FROM qspecies q JOIN tree ON (q.qspeciesid = tree.qspeciesid) JOIN thumbnail ON ' +
      '(q.qspeciesid = thumbnail.qspeciesid) JOIN likes ON (tree.treeid = likes.treeid)' + ' WHERE username = $1;';
    client.query(selectLikes, [username], function(error, results) {
      console.log('err', error);
      console.log('results is ', results);
      res.send(results.rows);
      done();
    });
  });
};

/**
 * This gets a list of users which like a particular tree. It takes a treeid.
 * @param req
 * @param res
 */
exports.getUserLikes = function(req, res) {
  var treeid = '' + req.body.treeId;
  pg.connect(conString, function(err, client, done) {
    // console.log(err);
    var selectLikes = 'SELECT username from likes WHERE treeid = $1;';
    client.query(selectLikes, [treeid], function(error, results) {
      console.log('results is ', results);
      res.send(results.rows);
      done();
    });
  });
};

/**
 * Insert comments for a message into comments table. This takes a username, comment, treeid, and messageid.
 * @param req
 * @param res
 */
exports.insertComments = function(req, res) {
  console.log('insert comments');
  var username = req.body.username;
  var comment = req.body.comment;
  var treeid = req.body.treeid;
  var messageid = req.message.messageid;
  pg.connect(conString, function(err, client, done) {
    if (err) {
      console.log('error is', err);
    }
    else {
      var insertComments = 'INSERT INTO comment (comment, username, treeid, messageid, createdat) values ($1, $2, $3, $5, now) RETURNING *;';
      client.query(insertComments, [comment, username, treeid, messageid], function(error, results) {
        console.log('postCommentFromUser result is ', results.rows);
        res.json(results.rows);
        done();
      });
    }
  });
};

/**
 * Gets comments from the database for a particular message. This takes a messageid.
 * @param req
 * @param res
 */
exports.getComments = function(req, res) {
  var messageid = req.params.messageid;
  console.log('in getComment');
  pg.connect(conString, function(err, client, done) {
    // console.log(err);
    var selectMessages = 'SELECT comment.comment, message.treeid, message.username, comment.createdAt FROM comments  WHERE messageid = $1 LIMIT 100;';
    client.query(selectMessages, [messageid], function(error, results) {
      res.json(results.rows);
    });
    done();
  });
};

/**
 * This queries the database for a location withing 0.01 from the users longitude and latitude. It expects a latitude
 * and longitude.
 * @param req
 * @param res
 */
exports.findTreesByLocation = function(req, res) {
  console.log('find by loc');
  var lat = parseFloat(req.query.latitude);
  var lng = parseFloat(req.query.longitude);
  var upperLongitude = lng + 0.001;
  var upperLatitude = lat + 0.001;
  var lowerLatitude = lat - 0.001;
  var lowerLongitude = lng - 0.001;
  pg.connect(conString, function(err, client, done) {
    var locationQuery = 'SELECT tree.name, tree.treeid, q.qspecies, l.latitude, l.longitude, thumbnail.url, thumbnail.width, thumbnail.height, thumbnail.contenttype FROM qspecies q JOIN tree ON (q.qspeciesid = tree.qspeciesid) JOIN "location" l ON (l.locationid = tree.locationid) JOIN thumbnail ON (q.qspeciesid = thumbnail.qspeciesid) WHERE ' +
      '(l.latitude BETWEEN $1 AND $2) AND (l.longitude BETWEEN $3 AND $4)';
    client.query(locationQuery, [lowerLatitude, upperLatitude, lowerLongitude, upperLongitude], function(error, results) {
      // console.log('error', error);
      //console.log('results', results);
      // console.log(results.rows);
      res.json(results.rows);
      done();
    });
  });
};

/**
 * Return an image for a tree. This function takes a treeid.
 * @param req
 * @param res
 */
exports.getTreeImage = function(req, res) {
  var treeid = req.params.treeId;
  pg.connect(conString, function(err, client, done) {
    // console.log(err);
    var getImage = 'SELECT image.imageurl, image.imagewidth, image.imageheight, image.imagetype FROM image JOIN qspecies ON qspecies.qspeciesid = image.qspeciesid JOIN tree on tree.qspeciesid = qspecies.qspeciesid  WHERE tree.treeid = $1;';
    client.query(getImage, [treeid], function(error, results) {
      // console.log('err',error);
      // console.log('THESE results is ', results);
      res.send(results.rows[0]);
      done();
    });
  });
};


//This can be refactored to store image in DB instead of locally in folder
/**
 * This function uploads a profile image to the azure cdn.
 * @param req
 * @param res
 * @param imageName
 * @param cb
 */
exports.uploadUserImage = function(req, res, imageName, cb) {
  //packages/articles/server/controllers/test/uploads/
  var localPath = 'packages/theme/public/assets/img/uploads/' + imageName;
  blobSvc.createBlockBlobFromLocalFile('userpictures', imageName, localPath, function(error, result, response) {
    if (!error) {
      console.log('file uploaded');
      cb();
    } else {
      console.log('error on image upload is ', error);
      return error;
    }
  });
};


/**
 * Inserts a New Tree into DB with provided information.
 * @param req
 * @param res
 *
 * TODO: Hook up tree api to Angular Add Tree Form
 */
exports.addTree = function (req, res, next) {
  var locationQuery = 'INSERT INTO location (xcoord, ycoord , latitude, longitude) select $1, $2, $3, $4 WHERE NOT EXISTS (SELECT xcoord FROM location WHERE xcoord = $1 and ycoord = $2);';
  var treeQuery = 'INSERT INTO tree (name, qspeciesid, siteorder, qsiteinfo, qcaretaker, plantdate, dbh, plotsize, permitnotes, treeid, locationid) SELECT $1, (select distinct qspeciesid from qspecies where qspecies = $2 limit 1), $3, $4, $5, $6, $7, $8, $9, $10, (select distinct locationid from location where xcoord = $11 limit 1) WHERE NOT EXISTS (SELECT treeid FROM tree WHERE treeid = $10);';
  var qspeciesQuery = 'INSERT INTO qspecies (qspecies) SELECT $1 WHERE NOT EXISTS (SELECT qspecies FROM qspecies WHERE qspecies = $1);';
  var tree = req.body;
  pg.connect(conString, function (err, client, done) {
    console.log('data rec from client', tree);

    var longitude = tree.location.longitude || '9999';
    var latitude = tree.location.latitude || '9999';
    var xcoord = tree.xcoord || '9999';
    var ycoord = tree.ycoord || '9999';

    client.query(locationQuery, [xcoord, ycoord, latitude, longitude], function (error, results) {
      console.log('Finished location inserts! for location', error, results);
      done();
    });

    var qspecies = tree.qspecies;

    client.query(qspeciesQuery, [tree.qspecies], function (error, results) {
      console.log('Finished tree inserts! for query', error, results);
      done();
    });

    var name = tree.name;
    var treeid = tree.treeid;
    var siteorder = tree.siteorder || 9999;
    var qsiteinfo = tree.qsiteinfo || 'unknown';
    var qcaretaker = tree.qcaretaker || 'unknown';
    var plantdate = tree.plantdate || new Date(0);
    var dbh = tree.dbh || 999;
    var plotsize = tree.plotsize || 'unknown';
    var permitnotes = tree.permitnotes || 'unknown';

    console.log(name, qspecies, longitude, latitude);

    client.query(treeQuery, [name, qspecies, siteorder, qsiteinfo, qcaretaker, plantdate, dbh, plotsize, permitnotes, treeid, xcoord], function (error, results) {
      console.log('Finished tree inserts!', error, results);
      res.json(results);
      done();
      client.end();
    });

  });
};