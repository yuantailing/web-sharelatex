const Path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const async = require('async')
const logger = require('logger-sharelatex')
const HttpErrors = require('@overleaf/o-error/http')
const { ObjectId } = require('mongodb')
const Errors = require('../Errors/Errors')
const ProjectDeleter = require('./ProjectDeleter')
const ProjectDuplicator = require('./ProjectDuplicator')
const ProjectCreationHandler = require('./ProjectCreationHandler')
const ProjectDetailsHandler = require('./ProjectDetailsHandler')
const EditorController = require('../Editor/EditorController')
const ProjectHelper = require('./ProjectHelper')
const metrics = require('metrics-sharelatex')
const { User } = require('../../models/User')
const TagsHandler = require('../Tags/TagsHandler')
const SubscriptionLocator = require('../Subscription/SubscriptionLocator')
const NotificationsHandler = require('../Notifications/NotificationsHandler')
const LimitationsManager = require('../Subscription/LimitationsManager')
const Settings = require('settings-sharelatex')
const AuthorizationManager = require('../Authorization/AuthorizationManager')
const InactiveProjectManager = require('../InactiveData/InactiveProjectManager')
const ProjectUpdateHandler = require('./ProjectUpdateHandler')
const ProjectGetter = require('./ProjectGetter')
const PrivilegeLevels = require('../Authorization/PrivilegeLevels')
const AuthenticationController = require('../Authentication/AuthenticationController')
const PackageVersions = require('../../infrastructure/PackageVersions')
const Sources = require('../Authorization/Sources')
const TokenAccessHandler = require('../TokenAccess/TokenAccessHandler')
const CollaboratorsGetter = require('../Collaborators/CollaboratorsGetter')
const Modules = require('../../infrastructure/Modules')
const ProjectEntityHandler = require('./ProjectEntityHandler')
const UserGetter = require('../User/UserGetter')
const NotificationsBuilder = require('../Notifications/NotificationsBuilder')
const { V1ConnectionError } = require('../Errors/Errors')
const Features = require('../../infrastructure/Features')
const BrandVariationsHandler = require('../BrandVariations/BrandVariationsHandler')
const { getUserAffiliations } = require('../Institutions/InstitutionsAPI')
const V1Handler = require('../V1/V1Handler')
const { Project } = require('../../models/Project')

const ProjectController = {
  _isInPercentageRollout(rolloutName, objectId, percentage) {
    if (Settings.bypassPercentageRollouts === true) {
      return true
    }
    const data = `${rolloutName}:${objectId.toString()}`
    const md5hash = crypto
      .createHash('md5')
      .update(data)
      .digest('hex')
    const counter = parseInt(md5hash.slice(26, 32), 16)
    return counter % 100 < percentage
  },

  updateProjectSettings(req, res, next) {
    const projectId = req.params.Project_id

    const jobs = []

    if (req.body.compiler != null) {
      jobs.push(callback =>
        EditorController.setCompiler(projectId, req.body.compiler, callback)
      )
    }

    if (req.body.imageName != null) {
      jobs.push(callback =>
        EditorController.setImageName(projectId, req.body.imageName, callback)
      )
    }

    if (req.body.name != null) {
      jobs.push(callback =>
        EditorController.renameProject(projectId, req.body.name, callback)
      )
    }

    if (req.body.spellCheckLanguage != null) {
      jobs.push(callback =>
        EditorController.setSpellCheckLanguage(
          projectId,
          req.body.spellCheckLanguage,
          callback
        )
      )
    }

    if (req.body.rootDocId != null) {
      jobs.push(callback =>
        EditorController.setRootDoc(projectId, req.body.rootDocId, callback)
      )
    }

    async.series(jobs, error => {
      if (error != null) {
        return next(error)
      }
      res.sendStatus(204)
    })
  },

  updateProjectAdminSettings(req, res, next) {
    const projectId = req.params.Project_id

    const jobs = []
    if (req.body.publicAccessLevel != null) {
      jobs.push(callback =>
        EditorController.setPublicAccessLevel(
          projectId,
          req.body.publicAccessLevel,
          callback
        )
      )
    }

    async.series(jobs, error => {
      if (error != null) {
        return next(error)
      }
      res.sendStatus(204)
    })
  },

  deleteProject(req, res) {
    const projectId = req.params.Project_id
    const forever = (req.query != null ? req.query.forever : undefined) != null
    logger.log({ projectId, forever }, 'received request to archive project')
    const user = AuthenticationController.getSessionUser(req)
    const cb = err => {
      if (err != null) {
        res.sendStatus(500)
      } else {
        res.sendStatus(200)
      }
    }

    if (forever) {
      ProjectDeleter.deleteProject(
        projectId,
        { deleterUser: user, ipAddress: req.ip },
        cb
      )
    } else {
      ProjectDeleter.legacyArchiveProject(projectId, cb)
    }
  },

  archiveProject(req, res, next) {
    const projectId = req.params.Project_id
    logger.log({ projectId }, 'received request to archive project')

    const user = AuthenticationController.getSessionUser(req)

    ProjectDeleter.archiveProject(projectId, user._id, function(err) {
      if (err != null) {
        return next(err)
      } else {
        return res.sendStatus(200)
      }
    })
  },

  unarchiveProject(req, res, next) {
    const projectId = req.params.Project_id
    logger.log({ projectId }, 'received request to unarchive project')

    const user = AuthenticationController.getSessionUser(req)

    ProjectDeleter.unarchiveProject(projectId, user._id, function(err) {
      if (err != null) {
        return next(err)
      } else {
        return res.sendStatus(200)
      }
    })
  },

  expireDeletedProjectsAfterDuration(req, res) {
    logger.log(
      'received request to look for old deleted projects and expire them'
    )
    ProjectDeleter.expireDeletedProjectsAfterDuration(err => {
      if (err != null) {
        res.sendStatus(500)
      } else {
        res.sendStatus(200)
      }
    })
  },

  expireDeletedProject(req, res, next) {
    const { projectId } = req.params
    logger.log('received request to expire deleted project', { projectId })
    ProjectDeleter.expireDeletedProject(projectId, err => {
      if (err != null) {
        next(err)
      } else {
        res.sendStatus(200)
      }
    })
  },

  restoreProject(req, res) {
    const projectId = req.params.Project_id
    logger.log({ projectId }, 'received request to restore project')
    ProjectDeleter.restoreProject(projectId, err => {
      if (err != null) {
        res.sendStatus(500)
      } else {
        res.sendStatus(200)
      }
    })
  },

  trashProject(req, res, next) {
    const projectId = req.params.project_id
    const userId = AuthenticationController.getLoggedInUserId(req)

    Project.update(
      { _id: projectId },
      { $addToSet: { trashed: userId } },
      error => {
        if (error) {
          return next(error)
        }
        res.sendStatus(200)
      }
    )
  },

  untrashProject(req, res, next) {
    const projectId = req.params.project_id
    const userId = AuthenticationController.getLoggedInUserId(req)

    Project.update(
      { _id: projectId },
      { $pull: { trashed: userId } },
      error => {
        if (error) {
          return next(error)
        }
        res.sendStatus(200)
      }
    )
  },

  cloneProject(req, res, next) {
    res.setTimeout(5 * 60 * 1000) // allow extra time for the copy to complete
    metrics.inc('cloned-project')
    const projectId = req.params.Project_id
    const { projectName } = req.body
    logger.log({ projectId, projectName }, 'cloning project')
    if (!AuthenticationController.isUserLoggedIn(req)) {
      return res.send({ redir: '/SHARELATEX/register' })
    }
    const currentUser = AuthenticationController.getSessionUser(req)
    ProjectDuplicator.duplicate(
      currentUser,
      projectId,
      projectName,
      (err, project) => {
        if (err != null) {
          logger.warn(
            { err, projectId, userId: currentUser._id },
            'error cloning project'
          )
          return next(err)
        }
        res.send({
          name: project.name,
          project_id: project._id,
          owner_ref: project.owner_ref
        })
      }
    )
  },

  newProject(req, res, next) {
    const userId = AuthenticationController.getLoggedInUserId(req)
    const projectName =
      req.body.projectName != null ? req.body.projectName.trim() : undefined
    const { template } = req.body
    logger.log(
      { user: userId, projectType: template, name: projectName },
      'creating project'
    )
    async.waterfall(
      [
        cb => {
          if (template === 'example') {
            ProjectCreationHandler.createExampleProject(userId, projectName, cb)
          } else {
            ProjectCreationHandler.createBasicProject(userId, projectName, cb)
          }
        }
      ],
      (err, project) => {
        if (err != null) {
          return next(err)
        }
        logger.log(
          { project, userId, name: projectName, templateType: template },
          'created project'
        )
        res.send({ project_id: project._id })
      }
    )
  },

  renameProject(req, res, next) {
    const projectId = req.params.Project_id
    const newName = req.body.newProjectName
    EditorController.renameProject(projectId, newName, err => {
      if (err != null) {
        return next(err)
      }
      res.sendStatus(200)
    })
  },

  userProjectsJson(req, res, next) {
    const userId = AuthenticationController.getLoggedInUserId(req)
    ProjectGetter.findAllUsersProjects(
      userId,
      'name lastUpdated publicAccesLevel archived trashed owner_ref tokens',
      (err, projects) => {
        if (err != null) {
          return next(err)
        }
        projects = ProjectController._buildProjectList(projects, userId)
          .filter(p => !ProjectHelper.isArchivedOrTrashed(p, userId))
          .filter(p => !p.isV1Project)
          .map(p => ({ _id: p.id, name: p.name, accessLevel: p.accessLevel }))

        res.json({ projects })
      }
    )
  },

  projectEntitiesJson(req, res, next) {
    const projectId = req.params.Project_id
    ProjectGetter.getProject(projectId, (err, project) => {
      if (err != null) {
        return next(err)
      }
      ProjectEntityHandler.getAllEntitiesFromProject(
        project,
        (err, docs, files) => {
          if (err != null) {
            return next(err)
          }
          const entities = docs
            .concat(files)
            .sort((a, b) => a.path > b.path) // Sort by path ascending
            .map(e => ({
              path: e.path,
              type: e.doc != null ? 'doc' : 'file'
            }))
          res.json({ project_id: projectId, entities })
        }
      )
    })
  },

  projectListPage(req, res, next) {
    const timer = new metrics.Timer('project-list')
    const userId = AuthenticationController.getLoggedInUserId(req)
    const currentUser = AuthenticationController.getSessionUser(req)
    async.parallel(
      {
        tags(cb) {
          TagsHandler.getAllTags(userId, cb)
        },
        notifications(cb) {
          NotificationsHandler.getUserNotifications(userId, cb)
        },
        projects(cb) {
          ProjectGetter.findAllUsersProjects(
            userId,
            'name lastUpdated lastUpdatedBy publicAccesLevel archived owner_ref tokens',
            cb
          )
        },
        v1Projects(cb) {
          if (!Features.hasFeature('overleaf-integration')) {
            return cb(null, null)
          }

          Modules.hooks.fire('findAllV1Projects', userId, (error, projects) => {
            if (projects == null) {
              projects = []
            }
            if (error != null && error instanceof V1ConnectionError) {
              return cb(null, { projects: [], tags: [], noConnection: true })
            }
            cb(error, projects[0])
          })
        }, // hooks.fire returns an array of results, only need first
        hasSubscription(cb) {
          LimitationsManager.hasPaidSubscription(
            currentUser,
            (error, hasPaidSubscription) => {
              if (error != null && error instanceof V1ConnectionError) {
                return cb(null, true)
              }
              cb(error, hasPaidSubscription)
            }
          )
        },
        user(cb) {
          User.findById(
            userId,
            'featureSwitches overleaf awareOfV2 features lastLoginIp',
            cb
          )
        },
        userAffiliations(cb) {
          if (!Features.hasFeature('affiliations')) {
            return cb(null, null)
          }
          getUserAffiliations(userId, cb)
        }
      },
      (err, results) => {
        if (err != null) {
          logger.warn({ err }, 'error getting data for project list page')
          return next(err)
        }
        const v1Tags =
          (results.v1Projects != null ? results.v1Projects.tags : undefined) ||
          []
        const tags = results.tags.concat(v1Tags)
        const notifications = results.notifications
        for (const notification of notifications) {
          notification.html = req.i18n.translate(
            notification.templateKey,
            notification.messageOpts
          )
        }
        const portalTemplates = ProjectController._buildPortalTemplatesList(
          results.userAffiliations
        )
        const projects = ProjectController._buildProjectList(
          results.projects,
          userId,
          results.v1Projects != null ? results.v1Projects.projects : undefined
        )
        const { user } = results
        const { userAffiliations } = results
        const warnings = ProjectController._buildWarningsList(
          results.v1Projects
        )

        // in v2 add notifications for matching university IPs
        if (Settings.overleaf != null && req.ip !== user.lastLoginIp) {
          NotificationsBuilder.ipMatcherAffiliation(user._id).create(req.ip)
        }

        ProjectController._injectProjectUsers(projects, (error, projects) => {
          if (error != null) {
            return next(error)
          }
          const viewModel = {
            title: 'your_projects',
            priority_title: true,
            projects,
            tags,
            notifications: notifications || [],
            portalTemplates,
            user,
            userAffiliations,
            hasSubscription: results.hasSubscription,
            isShowingV1Projects: results.v1Projects != null,
            warnings,
            zipFileSizeLimit: Settings.maxUploadSize
          }

          if (
            Settings.algolia &&
            Settings.algolia.app_id &&
            Settings.algolia.read_only_api_key
          ) {
            viewModel.showUserDetailsArea = true
            viewModel.algolia_api_key = Settings.algolia.read_only_api_key
            viewModel.algolia_app_id = Settings.algolia.app_id
          } else {
            viewModel.showUserDetailsArea = false
          }

          const paidUser =
            (user.features != null ? user.features.github : undefined) &&
            (user.features != null ? user.features.dropbox : undefined) // use a heuristic for paid account
          const freeUserProportion = 0.1
          const sampleFreeUser =
            parseInt(user._id.toString().slice(-2), 16) <
            freeUserProportion * 255
          const showFrontWidget = paidUser || sampleFreeUser
          logger.log(
            { paidUser, sampleFreeUser, showFrontWidget },
            'deciding whether to show front widget'
          )
          if (showFrontWidget) {
            viewModel.frontChatWidgetRoomId =
              Settings.overleaf != null
                ? Settings.overleaf.front_chat_widget_room_id
                : undefined
          }

          res.render('project/list', viewModel)
          timer.done()
        })
      }
    )
  },

  loadEditor(req, res, next) {
    let anonymous, userId
    const timer = new metrics.Timer('load-editor')
    if (!Settings.editorIsOpen) {
      return res.render('general/closed', { title: 'updating_site' })
    }

    if (AuthenticationController.isUserLoggedIn(req)) {
      userId = AuthenticationController.getLoggedInUserId(req)
      anonymous = false
    } else {
      anonymous = true
      userId = null
    }

    const projectId = req.params.Project_id
    logger.log({ projectId, anonymous, userId }, 'loading editor')

    // record failures to load the custom websocket
    if ((req.query != null ? req.query.ws : undefined) === 'fallback') {
      metrics.inc('load-editor-ws-fallback')
    }

    async.auto(
      {
        project(cb) {
          ProjectGetter.getProject(
            projectId,
            {
              name: 1,
              lastUpdated: 1,
              track_changes: 1,
              owner_ref: 1,
              brandVariationId: 1,
              overleaf: 1,
              tokens: 1
            },
            (err, project) => {
              if (err != null) {
                return cb(err)
              }
              if (
                (project.overleaf != null ? project.overleaf.id : undefined) ==
                  null ||
                (project.tokens != null
                  ? project.tokens.readAndWrite
                  : undefined) == null ||
                Settings.projectImportingCheckMaxCreateDelta == null
              ) {
                return cb(null, project)
              }
              const createDelta =
                (new Date().getTime() -
                  new Date(project._id.getTimestamp()).getTime()) /
                1000
              if (
                !(createDelta < Settings.projectImportingCheckMaxCreateDelta)
              ) {
                return cb(null, project)
              }
              V1Handler.getDocExported(
                project.tokens.readAndWrite,
                (err, docExported) => {
                  if (err != null) {
                    return next(err)
                  }
                  project.exporting = docExported.exporting
                  cb(null, project)
                }
              )
            }
          )
        },
        user(cb) {
          if (userId == null) {
            cb(null, defaultSettingsForAnonymousUser(userId))
          } else {
            User.findById(userId, (err, user) => {
              logger.log({ projectId, userId }, 'got user')
              cb(err, user)
            })
          }
        },
        subscription(cb) {
          if (userId == null) {
            return cb()
          }
          SubscriptionLocator.getUsersSubscription(userId, cb)
        },
        activate(cb) {
          InactiveProjectManager.reactivateProjectIfRequired(projectId, cb)
        },
        markAsOpened(cb) {
          // don't need to wait for this to complete
          ProjectUpdateHandler.markAsOpened(projectId, () => {})
          cb()
        },
        isTokenMember(cb) {
          if (userId == null) {
            return cb()
          }
          CollaboratorsGetter.userIsTokenMember(userId, projectId, cb)
        },
        brandVariation: [
          'project',
          (cb, results) => {
            if (
              (results.project != null
                ? results.project.brandVariationId
                : undefined) == null
            ) {
              return cb()
            }
            BrandVariationsHandler.getBrandVariationById(
              results.project.brandVariationId,
              (error, brandVariationDetails) => cb(error, brandVariationDetails)
            )
          }
        ]
      },
      (err, results) => {
        if (err != null) {
          logger.warn({ err }, 'error getting details for project page')
          return next(err)
        }
        const { project } = results
        const { user } = results
        const { subscription } = results
        const { brandVariation } = results

        const daysSinceLastUpdated =
          (new Date() - project.lastUpdated) / 86400000
        logger.log(
          { projectId, daysSinceLastUpdated },
          'got db results for loading editor'
        )

        const token = TokenAccessHandler.getRequestToken(req, projectId)
        const { isTokenMember } = results
        AuthorizationManager.getPrivilegeLevelForProject(
          userId,
          projectId,
          token,
          (error, privilegeLevel) => {
            let allowedFreeTrial
            if (error != null) {
              return next(error)
            }
            if (
              privilegeLevel == null ||
              privilegeLevel === PrivilegeLevels.NONE
            ) {
              return res.sendStatus(401)
            }

            if (project.exporting) {
              res.render('project/importing', { bodyClasses: ['editor'] })
              return
            }

            if (
              subscription != null &&
              subscription.freeTrial != null &&
              subscription.freeTrial.expiresAt != null
            ) {
              allowedFreeTrial = !!subscription.freeTrial.allowed || true
            }

            logger.log({ projectId }, 'rendering editor page')
            res.render('project/editor', {
              title: project.name,
              priority_title: true,
              bodyClasses: ['editor'],
              project_id: project._id,
              user: {
                id: userId,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                referal_id: user.referal_id,
                signUpDate: user.signUpDate,
                subscription: {
                  freeTrial: { allowed: allowedFreeTrial }
                },
                featureSwitches: user.featureSwitches,
                features: user.features,
                refProviders: user.refProviders,
                betaProgram: user.betaProgram,
                isAdmin: user.isAdmin
              },
              userSettings: {
                mode: user.ace.mode,
                editorTheme: user.ace.theme,
                fontSize: user.ace.fontSize,
                autoComplete: user.ace.autoComplete,
                autoPairDelimiters: user.ace.autoPairDelimiters,
                pdfViewer: user.ace.pdfViewer,
                syntaxValidation: user.ace.syntaxValidation,
                fontFamily: user.ace.fontFamily,
                lineHeight: user.ace.lineHeight,
                overallTheme: user.ace.overallTheme
              },
              trackChangesState: project.track_changes,
              privilegeLevel,
              chatUrl: Settings.apis.chat.url,
              anonymous,
              anonymousAccessToken: req._anonymousAccessToken,
              isTokenMember,
              isRestrictedTokenMember:
                privilegeLevel === 'readOnly' && (anonymous || isTokenMember),
              languages: Settings.languages,
              editorThemes: THEME_LIST,
              maxDocLength: Settings.max_doc_length,
              useV2History:
                project.overleaf &&
                project.overleaf.history &&
                Boolean(project.overleaf.history.display),
              showTestControls:
                (req.query && req.query.tc === 'true') || user.isAdmin,
              brandVariation,
              allowedImageNames: Settings.allowedImageNames || [],
              gitBridgePublicBaseUrl: Settings.gitBridgePublicBaseUrl
            })
            timer.done()
          }
        )
      }
    )
  },

  transferOwnership(req, res, next) {
    const sessionUser = AuthenticationController.getSessionUser(req)
    if (req.body.user_id == null) {
      return next(
        new HttpErrors.BadRequestError({
          info: { public: { message: 'Missing parameter: user_id' } }
        })
      )
    }
    let projectId
    try {
      projectId = ObjectId(req.params.Project_id)
    } catch (err) {
      return next(
        new HttpErrors.BadRequestError({
          info: {
            public: { message: `Invalid project id: ${req.params.Project_id}` }
          }
        })
      )
    }
    let toUserId
    try {
      toUserId = ObjectId(req.body.user_id)
    } catch (err) {
      return next(
        new HttpErrors.BadRequestError({
          info: { public: { message: `Invalid user id: ${req.body.user_id}` } }
        })
      )
    }
    ProjectDetailsHandler.transferOwnership(
      projectId,
      toUserId,
      { allowTransferToNonCollaborators: sessionUser.isAdmin },
      err => {
        if (err != null) {
          if (err instanceof Errors.ProjectNotFoundError) {
            next(
              new HttpErrors.NotFoundError({
                info: { public: { message: `project not found: ${projectId}` } }
              })
            )
          } else if (err instanceof Errors.UserNotFoundError) {
            next(
              new HttpErrors.NotFoundError({
                info: { public: { message: `user not found: ${toUserId}` } }
              })
            )
          } else if (err instanceof Errors.UserNotCollaboratorError) {
            next(
              new HttpErrors.ForbiddenError({
                info: {
                  public: {
                    message: `user ${toUserId} should be a collaborator in project ${projectId} prior to ownership transfer`
                  }
                }
              })
            )
          } else {
            next(err)
          }
        } else {
          res.sendStatus(204)
        }
      }
    )
  },

  _buildProjectList(allProjects, userId, v1Projects) {
    let project
    if (v1Projects == null) {
      v1Projects = []
    }
    const {
      owned,
      readAndWrite,
      readOnly,
      tokenReadAndWrite,
      tokenReadOnly
    } = allProjects
    const projects = []
    for (project of owned) {
      projects.push(
        ProjectController._buildProjectViewModel(
          project,
          'owner',
          Sources.OWNER,
          userId
        )
      )
    }
    // Invite-access
    for (project of readAndWrite) {
      projects.push(
        ProjectController._buildProjectViewModel(
          project,
          'readWrite',
          Sources.INVITE,
          userId
        )
      )
    }
    for (project of readOnly) {
      projects.push(
        ProjectController._buildProjectViewModel(
          project,
          'readOnly',
          Sources.INVITE,
          userId
        )
      )
    }
    for (project of v1Projects) {
      projects.push(ProjectController._buildV1ProjectViewModel(project))
    }
    // Token-access
    //   Only add these projects if they're not already present, this gives us cascading access
    //   from 'owner' => 'token-read-only'
    for (project of tokenReadAndWrite) {
      if (
        projects.filter(p => p.id.toString() === project._id.toString())
          .length === 0
      ) {
        projects.push(
          ProjectController._buildProjectViewModel(
            project,
            'readAndWrite',
            Sources.TOKEN,
            userId
          )
        )
      }
    }
    for (project of tokenReadOnly) {
      if (
        projects.filter(p => p.id.toString() === project._id.toString())
          .length === 0
      ) {
        projects.push(
          ProjectController._buildProjectViewModel(
            project,
            'readOnly',
            Sources.TOKEN,
            userId
          )
        )
      }
    }

    return projects
  },

  _buildProjectViewModel(project, accessLevel, source, userId) {
    TokenAccessHandler.protectTokens(project, accessLevel)
    const model = {
      id: project._id,
      name: project.name,
      lastUpdated: project.lastUpdated,
      lastUpdatedBy: project.lastUpdatedBy,
      publicAccessLevel: project.publicAccesLevel,
      accessLevel,
      source,
      archived: ProjectHelper.isArchived(project, userId),
      owner_ref: project.owner_ref,
      tokens: project.tokens,
      isV1Project: false
    }
    if (accessLevel === PrivilegeLevels.READ_ONLY && source === Sources.TOKEN) {
      model.owner_ref = null
      model.lastUpdatedBy = null
    }
    return model
  },

  _buildV1ProjectViewModel(project) {
    const projectViewModel = {
      id: project.id,
      name: project.title,
      lastUpdated: new Date(project.updated_at * 1000), // Convert from epoch
      archived: project.removed || project.archived,
      isV1Project: true
    }
    if (
      (project.owner != null && project.owner.user_is_owner) ||
      (project.creator != null && project.creator.user_is_creator)
    ) {
      projectViewModel.accessLevel = 'owner'
    } else {
      projectViewModel.accessLevel = 'readOnly'
    }
    if (project.owner != null) {
      projectViewModel.owner = {
        first_name: project.owner.name
      }
    } else if (project.creator != null) {
      projectViewModel.owner = {
        first_name: project.creator.name
      }
    }
    return projectViewModel
  },

  _injectProjectUsers(projects, callback) {
    const users = {}
    for (const project of projects) {
      if (project.owner_ref != null) {
        users[project.owner_ref.toString()] = true
      }
      if (project.lastUpdatedBy != null) {
        users[project.lastUpdatedBy.toString()] = true
      }
    }

    const userIds = Object.keys(users)
    async.eachSeries(
      userIds,
      (userId, cb) => {
        UserGetter.getUser(
          userId,
          { first_name: 1, last_name: 1, email: 1 },
          (error, user) => {
            if (error != null) {
              return cb(error)
            }
            users[userId] = user
            cb()
          }
        )
      },
      error => {
        if (error != null) {
          return callback(error)
        }
        for (const project of projects) {
          if (project.owner_ref != null) {
            project.owner = users[project.owner_ref.toString()]
          }
          if (project.lastUpdatedBy != null) {
            project.lastUpdatedBy =
              users[project.lastUpdatedBy.toString()] || null
          }
        }
        callback(null, projects)
      }
    )
  },

  _buildWarningsList(v1ProjectData) {
    if (v1ProjectData == null) {
      v1ProjectData = {}
    }
    const warnings = []
    if (v1ProjectData.noConnection && Settings.overleaf) {
      warnings.push('No V1 Connection')
    }
    if (v1ProjectData.hasHiddenV1Projects) {
      warnings.push(
        "Looks like you've got a lot of V1 projects! Some of them may be hidden on V2. To view them all, use the V1 dashboard."
      )
    }
    return warnings
  },

  _buildPortalTemplatesList(affiliations) {
    if (affiliations == null) {
      affiliations = []
    }
    const portalTemplates = []
    for (let aff of affiliations) {
      if (
        aff.portal &&
        aff.portal.slug &&
        aff.portal.templates_count &&
        aff.portal.templates_count > 0
      ) {
        const portalPath = aff.institution.isUniversity ? '/edu/' : '/org/'
        portalTemplates.push({
          name: aff.institution.name,
          url: Settings.siteUrl + portalPath + aff.portal.slug
        })
      }
    }
    return portalTemplates
  }
}

var defaultSettingsForAnonymousUser = userId => ({
  id: userId,
  ace: {
    mode: 'none',
    theme: 'textmate',
    fontSize: '12',
    autoComplete: true,
    spellCheckLanguage: '',
    pdfViewer: '',
    syntaxValidation: true
  },
  subscription: {
    freeTrial: {
      allowed: true
    }
  },
  featureSwitches: {
    github: false
  }
})

var THEME_LIST = []
function generateThemeList() {
  const files = fs.readdirSync(
    Path.join(__dirname, '/../../../../public/js/', PackageVersions.lib('ace'))
  )
  const result = []
  for (let file of files) {
    if (file.slice(-2) === 'js' && /^theme-/.test(file)) {
      const cleanName = file.slice(0, -3).slice(6)
      result.push(THEME_LIST.push(cleanName))
    } else {
      result.push(undefined)
    }
  }
}
generateThemeList()

module.exports = ProjectController
