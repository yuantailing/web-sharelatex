let AuthenticationManager
const Settings = require('settings-sharelatex')
const { User } = require('../../models/User')
const { db, ObjectId } = require('../../infrastructure/mongojs')
const bcrypt = require('bcrypt')
const EmailHelper = require('../Helpers/EmailHelper')
const V1Handler = require('../V1/V1Handler')

const BCRYPT_ROUNDS = Settings.security.bcryptRounds || 12
const BCRYPT_MINOR_VERSION = Settings.security.bcryptMinorVersion || 'a'

const _checkWriteResult = function(result, callback) {
  // for MongoDB
  if (result && result.nModified === 1) {
    callback(null, true)
  } else {
    callback(null, false)
  }
}

module.exports = AuthenticationManager = {
  authenticate(query, password, callback) {
    // Using Mongoose for legacy reasons here. The returned User instance
    // gets serialized into the session and there may be subtle differences
    // between the user returned by Mongoose vs mongojs (such as default values)
    if (callback == null) {
      callback = function(error, user) {}
    }
    const process = require('process');
    const request = require('request');
    const UserRegistrationHandler = require('../User/UserRegistrationHandler');
    if (typeof(password) === 'object' && password.provider == 'github') { // GitHub OAuth
      return User.findOne({
        $query: {'thirdPartyIdentifiers.providerId': 'github', 'thirdPartyIdentifiers.externalUserId': password.id.toString()},
        $orderby: [['_id', 1]],
      }, (error, user) => {
        if (error)
          return callback(error);
        if (user != null)
          return callback(null, user);
        return request.get({
          url: 'https://api.github.com/orgs/thu-media/members/' + password.login,
          headers: {Authorization: 'token ' + Settings.cgservice.GITHUB_PERSONAL_ACCESS_TOKEN, 'User-Agent': 'Sharelatex Community Plus'},
          json: true,
        }, function (e, r, body) {
          if (e)
            return callback(e);
          if (r.statusCode != 204)
            return callback(null, null);
          return UserRegistrationHandler.registerNewUser({
            email: require('crypto').randomBytes(8).toString('hex') + '@example.com',
            password: require('crypto').randomBytes(32).toString('hex'),
            first_name: password.login,
            thirdPartyIdentifiers: [{providerId: 'github', externalUserId: password.id.toString()}],
          }, (error, user) => {
            if (error != null)
              return callback(error);
            return callback(null, user);
          });
        });
      });
    }
    return request.post({
      url: 'https://cg.cs.tsinghua.edu.cn/serverlist/opencheckuser',
      form: {
        'username' : query.email,
        'password': password,
        'client' : 'sharelatex',
        'api_secret': process.env.CGSERVER_API_SECRET,
      },
    }, (err, response, body) => {
      if (err)
        return callback(null, null);
      if (response.statusCode !== 200)
        return callback(null, null);
      var data = JSON.parse(body);
      if (data.error) {
        return User.findOne(query, (error, user) => {
          if (error) {
            return callback(error)
          }
          if (!user || !user.hashedPassword) {
            return callback(null, null)
          }
          bcrypt.compare(password, user.hashedPassword, function(error, match) {
            if (error) {
              return callback(error)
            }
            if (!match) {
              return callback(null, null)
            }
            AuthenticationManager.checkRounds(
              user,
              user.hashedPassword,
              password,
              function(err) {
                if (err) {
                  return callback(err)
                }
                callback(null, user)
              }
            )
          })
        })
      }
      return User.findOne({
        $query: {'thirdPartyIdentifiers.providerId': 'cgserver', 'thirdPartyIdentifiers.externalUserId': data.user_id.toString()},
        $orderby: [['_id', 1]],
      }, (error, user) => {
        if (error != null)
          return callback(error);
        if (user != null)
          return callback(null, user);
        return UserRegistrationHandler.registerNewUser({
          email: require('crypto').randomBytes(8).toString('hex') + '@example.com',
          password: require('crypto').randomBytes(32).toString('hex'),
          first_name: query.email,
          thirdPartyIdentifiers: [{providerId: 'cgserver', externalUserId: data.user_id.toString()}],
        }, (error, user) => {
          if (error != null)
            return callback(error);
          return callback(null, user);
        });
      });
    });
  },

  validateEmail(email) {
    const parsed = EmailHelper.parseEmail(email)
    if (!parsed) {
      return { message: 'email not valid' }
    }
    return null
  },

  // validates a password based on a similar set of rules to `complexPassword.js` on the frontend
  // note that `passfield.js` enforces more rules than this, but these are the most commonly set.
  // returns null on success, or an error string.
  validatePassword(password) {
    if (password == null) {
      return { message: 'password not set' }
    }

    let allowAnyChars, min, max
    if (Settings.passwordStrengthOptions) {
      allowAnyChars = Settings.passwordStrengthOptions.allowAnyChars === true
      if (Settings.passwordStrengthOptions.length) {
        min = Settings.passwordStrengthOptions.length.min
        max = Settings.passwordStrengthOptions.length.max
      }
    }
    allowAnyChars = !!allowAnyChars
    min = min || 6
    max = max || 72

    // we don't support passwords > 72 characters in length, because bcrypt truncates them
    if (max > 72) {
      max = 72
    }

    if (password.length < min) {
      return { message: 'password is too short' }
    }
    if (password.length > max) {
      return { message: 'password is too long' }
    }
    if (
      !allowAnyChars &&
      !AuthenticationManager._passwordCharactersAreValid(password)
    ) {
      return { message: 'password contains an invalid character' }
    }
    return null
  },

  setUserPassword(userId, password, callback) {
    AuthenticationManager.setUserPasswordInV2(userId, password, callback)
  },

  checkRounds(user, hashedPassword, password, callback) {
    // Temporarily disable this function, TODO: re-enable this
    if (Settings.security.disableBcryptRoundsUpgrades) {
      return callback()
    }
    // check current number of rounds and rehash if necessary
    const currentRounds = bcrypt.getRounds(hashedPassword)
    if (currentRounds < BCRYPT_ROUNDS) {
      AuthenticationManager.setUserPassword(user._id, password, callback)
    } else {
      callback()
    }
  },

  hashPassword(password, callback) {
    bcrypt.genSalt(BCRYPT_ROUNDS, BCRYPT_MINOR_VERSION, function(error, salt) {
      if (error) {
        return callback(error)
      }
      bcrypt.hash(password, salt, callback)
    })
  },

  setUserPasswordInV2(userId, password, callback) {
    const validation = this.validatePassword(password)
    if (validation) {
      return callback(validation.message)
    }
    this.hashPassword(password, function(error, hash) {
      if (error) {
        return callback(error)
      }
      db.users.update(
        {
          _id: ObjectId(userId.toString())
        },
        {
          $set: {
            hashedPassword: hash
          },
          $unset: {
            password: true
          }
        },
        function(updateError, result) {
          if (updateError) {
            return callback(updateError)
          }
          _checkWriteResult(result, callback)
        }
      )
    })
  },

  setUserPasswordInV1(v1UserId, password, callback) {
    const validation = this.validatePassword(password)
    if (validation) {
      return callback(validation.message)
    }

    V1Handler.doPasswordReset(v1UserId, password, function(error, reset) {
      if (error) {
        return callback(error)
      }
      callback(error, reset)
    })
  },

  _passwordCharactersAreValid(password) {
    let digits, letters, lettersUp, symbols
    if (
      Settings.passwordStrengthOptions &&
      Settings.passwordStrengthOptions.chars
    ) {
      digits = Settings.passwordStrengthOptions.chars.digits
      letters = Settings.passwordStrengthOptions.chars.letters
      lettersUp = Settings.passwordStrengthOptions.chars.letters_up
      symbols = Settings.passwordStrengthOptions.chars.symbols
    }
    digits = digits || '1234567890'
    letters = letters || 'abcdefghijklmnopqrstuvwxyz'
    lettersUp = lettersUp || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    symbols = symbols || '@#$%^&*()-_=+[]{};:<>/?!£€.,'

    for (let charIndex = 0; charIndex <= password.length - 1; charIndex++) {
      if (
        digits.indexOf(password[charIndex]) === -1 &&
        letters.indexOf(password[charIndex]) === -1 &&
        lettersUp.indexOf(password[charIndex]) === -1 &&
        symbols.indexOf(password[charIndex]) === -1
      ) {
        return false
      }
    }
    return true
  }
}
