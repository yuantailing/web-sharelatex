const { Project } = require('../../models/Project')
const PublicAccessLevels = require('../Authorization/PublicAccessLevels')
const PrivilegeLevels = require('../Authorization/PrivilegeLevels')
const UserGetter = require('../User/UserGetter')
const { ObjectId } = require('mongodb')
const Settings = require('settings-sharelatex')
const logger = require('logger-sharelatex')
const V1Api = require('../V1/V1Api')
const crypto = require('crypto')
const { promisifyAll } = require('../../util/promises')

const READ_AND_WRITE_TOKEN_PATTERN = '([0-9]+[a-z]{6,12})'
const READ_ONLY_TOKEN_PATTERN = '([a-z]{12})'

const TokenAccessHandler = {
  TOKEN_TYPES: {
    READ_ONLY: PrivilegeLevels.READ_ONLY,
    READ_AND_WRITE: PrivilegeLevels.READ_AND_WRITE
  },

  ANONYMOUS_READ_AND_WRITE_ENABLED:
    Settings.allowAnonymousReadAndWriteSharing === true,

  READ_AND_WRITE_TOKEN_PATTERN,
  READ_AND_WRITE_TOKEN_REGEX: new RegExp(`^${READ_AND_WRITE_TOKEN_PATTERN}$`),
  READ_AND_WRITE_URL_REGEX: new RegExp(`^/${READ_AND_WRITE_TOKEN_PATTERN}$`),

  READ_ONLY_TOKEN_PATTERN,
  READ_ONLY_TOKEN_REGEX: new RegExp(`^${READ_ONLY_TOKEN_PATTERN}$`),
  READ_ONLY_URL_REGEX: new RegExp(`^/read/${READ_ONLY_TOKEN_PATTERN}$`),

  makeReadAndWriteTokenUrl(token) {
    return `/${token}`
  },

  makeReadOnlyTokenUrl(token) {
    return `/read/${token}`
  },

  makeTokenUrl(token) {
    const tokenType = TokenAccessHandler.getTokenType(token)
    if (tokenType === TokenAccessHandler.TOKEN_TYPES.READ_AND_WRITE) {
      return TokenAccessHandler.makeReadAndWriteTokenUrl(token)
    } else if (tokenType === TokenAccessHandler.TOKEN_TYPES.READ_ONLY) {
      return TokenAccessHandler.makeReadOnlyTokenUrl(token)
    } else {
      throw new Error('invalid token type')
    }
  },

  getTokenType(token) {
    if (!token) {
      return null
    }
    if (token.match(`^${TokenAccessHandler.READ_ONLY_TOKEN_PATTERN}$`)) {
      return TokenAccessHandler.TOKEN_TYPES.READ_ONLY
    } else if (
      token.match(`^${TokenAccessHandler.READ_AND_WRITE_TOKEN_PATTERN}$`)
    ) {
      return TokenAccessHandler.TOKEN_TYPES.READ_AND_WRITE
    }
    return null
  },

  isReadOnlyToken(token) {
    return (
      TokenAccessHandler.getTokenType(token) ===
      TokenAccessHandler.TOKEN_TYPES.READ_ONLY
    )
  },

  isReadAndWriteToken(token) {
    return (
      TokenAccessHandler.getTokenType(token) ===
      TokenAccessHandler.TOKEN_TYPES.READ_AND_WRITE
    )
  },

  isValidToken(token) {
    return TokenAccessHandler.getTokenType(token) != null
  },

  tokenAccessEnabledForProject(project) {
    return project.publicAccesLevel === PublicAccessLevels.TOKEN_BASED
  },

  _projectFindOne(query, callback) {
    Project.findOne(
      query,
      {
        _id: 1,
        tokens: 1,
        publicAccesLevel: 1,
        owner_ref: 1,
        name: 1
      },
      callback
    )
  },

  getProjectByReadOnlyToken(token, callback) {
    TokenAccessHandler._projectFindOne({ 'tokens.readOnly': token }, callback)
  },

  _extractNumericPrefix(token) {
    return token.match(/^(\d+)\w+/)
  },

  _extractStringSuffix(token) {
    return token.match(/^\d+(\w+)/)
  },

  getProjectByReadAndWriteToken(token, callback) {
    const numericPrefixMatch = TokenAccessHandler._extractNumericPrefix(token)
    if (!numericPrefixMatch) {
      return callback(null, null)
    }
    const numerics = numericPrefixMatch[1]
    TokenAccessHandler._projectFindOne(
      {
        'tokens.readAndWritePrefix': numerics
      },
      function(err, project) {
        if (err != null) {
          return callback(err)
        }
        if (project == null) {
          return callback(null, null)
        }
        try {
          if (
            !crypto.timingSafeEqual(
              Buffer.from(token),
              Buffer.from(project.tokens.readAndWrite)
            )
          ) {
            logger.err(
              { token },
              'read-and-write token match on numeric section, but not on full token'
            )
            return callback(null, null)
          } else {
            return callback(null, project)
          }
        } catch (error) {
          err = error
          logger.err({ token, cryptoErr: err }, 'error comparing tokens')
          return callback(null, null)
        }
      }
    )
  },

  getProjectByToken(tokenType, token, callback) {
    if (tokenType === TokenAccessHandler.TOKEN_TYPES.READ_ONLY) {
      TokenAccessHandler.getProjectByReadOnlyToken(token, callback)
    } else if (tokenType === TokenAccessHandler.TOKEN_TYPES.READ_AND_WRITE) {
      TokenAccessHandler.getProjectByReadAndWriteToken(token, callback)
    } else {
      return callback(new Error('invalid token type'))
    }
  },

  addReadOnlyUserToProject(userId, projectId, callback) {
    userId = ObjectId(userId.toString())
    projectId = ObjectId(projectId.toString())
    Project.update(
      {
        _id: projectId
      },
      {
        $addToSet: { tokenAccessReadOnly_refs: userId }
      },
      callback
    )
  },

  addReadAndWriteUserToProject(userId, projectId, callback) {
    userId = ObjectId(userId.toString())
    projectId = ObjectId(projectId.toString())
    Project.update(
      {
        _id: projectId
      },
      {
        $addToSet: { tokenAccessReadAndWrite_refs: userId }
      },
      callback
    )
  },

  grantSessionTokenAccess(req, projectId, token) {
    if (!req.session) {
      return
    }
    if (!req.session.anonTokenAccess) {
      req.session.anonTokenAccess = {}
    }
    req.session.anonTokenAccess[projectId.toString()] = token
  },

  getRequestToken(req, projectId) {
    const token =
      (req.session &&
        req.session.anonTokenAccess &&
        req.session.anonTokenAccess[projectId.toString()]) ||
      req.headers['x-sl-anonymous-access-token']
    return token
  },

  validateTokenForAnonymousAccess(projectId, token, callback) {
    if (!token) {
      return callback(null, false, false)
    }
    const tokenType = TokenAccessHandler.getTokenType(token)
    if (!tokenType) {
      return callback(new Error('invalid token type'))
    }
    TokenAccessHandler.getProjectByToken(tokenType, token, (err, project) => {
      if (err) {
        return callback(err)
      }
      if (
        !project ||
        !TokenAccessHandler.tokenAccessEnabledForProject(project) ||
        project._id.toString() !== projectId.toString()
      ) {
        return callback(null, false, false)
      }
      // TODO: think about cleaning up this interface and its usage in AuthorizationManager
      return callback(
        null,
        tokenType === TokenAccessHandler.TOKEN_TYPES.READ_AND_WRITE &&
          TokenAccessHandler.ANONYMOUS_READ_AND_WRITE_ENABLED,
        tokenType === TokenAccessHandler.TOKEN_TYPES.READ_ONLY
      )
    })
  },

  protectTokens(project, privilegeLevel) {
    if (!project || !project.tokens) {
      return
    }
    if (privilegeLevel === PrivilegeLevels.OWNER) {
      return
    }
    if (privilegeLevel !== PrivilegeLevels.READ_AND_WRITE) {
      project.tokens.readAndWrite = ''
      project.tokens.readAndWritePrefix = ''
    }
    if (privilegeLevel !== PrivilegeLevels.READ_ONLY) {
      project.tokens.readOnly = ''
    }
  },

  getV1DocPublishedInfo(token, callback) {
    return Project.findOne({'publicAccesLevel': 'tokenBased', 'tokens.readOnly': token}, (error, project) => {
      if (error != null)
        return callback(error);
      if (project != null && project.publicAccesLevel === 'tokenBased' && project.tokens.readOnly === token)
        return callback(null, { allow: true });
      return callback(null, { allow: false });
    });
  },

  getV1DocInfo(token, v2UserId, callback) {
    if (!Settings.apis || !Settings.apis.v1) {
      return callback(null, {
        exists: true,
        exported: false
      })
    }
    UserGetter.getUser(v2UserId, { overleaf: 1 }, function(err, user) {
      if (err != null) {
        return callback(err)
      }
      const v1UserId = user.overleaf != null ? user.overleaf.id : undefined
      if (!v1UserId) {
        return callback(null, null)
      }
      V1Api.request(
        { url: `/api/v1/sharelatex/users/${v1UserId}/docs/${token}/info` },
        function(err, response, body) {
          if (err != null) {
            return callback(err)
          }
          callback(null, body)
        }
      )
    })
  }
}

TokenAccessHandler.promises = promisifyAll(TokenAccessHandler, {
  without: [
    'getTokenType',
    'tokenAccessEnabledForProject',
    '_extractNumericPrefix',
    '_extractStringSuffix',
    '_projectFindOne',
    'grantSessionTokenAccess',
    'getRequestToken',
    'protectTokens',
    'validateTokenForAnonymousAccess'
  ]
})

module.exports = TokenAccessHandler
