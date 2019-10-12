/* eslint-disable
    camelcase,
    max-len,
*/
const AuthenticationController = require('./Features/Authentication/AuthenticationController')
const AuthorizationMiddleware = require('./Features/Authorization/AuthorizationMiddleware')
const UserInfoManager = require('./Features/User/UserInfoManager')
const UserInfoController = require('./Features/User/UserInfoController')
const CollaboratorsHandler = require('./Features/Collaborators/CollaboratorsHandler')
const DocumentUpdaterHandler = require('./Features/DocumentUpdater/DocumentUpdaterHandler')
const DocstoreManager = require('./Features/Docstore/DocstoreManager')
const ChatApiHandler = require('./Features/Chat/ChatApiHandler')
const ChatController = require('./Features/Chat/ChatController')
const EditorRealTimeController = require('./Features/Editor/EditorRealTimeController')

const { Project } = require('./models/Project')

const async = require("async");
const passport = require('passport')
const logger = require('logger-sharelatex')

module.exports = { apply(webRouter) {

webRouter.get(
	'/githubcallback',
	function(req, res, next) {
		const { code, state } = req.query;
		const host = req.headers['x-forwarded-host'] || req.headers.host;
		logger.log({ state, host }, 'CG:GET:githubcallback');
		if (host == 'cg.cs.tsinghua.edu.cn' && state == 'www.thucg.com')
			return res.redirect('https://www.thucg.com' + req.originalUrl);
		passport.authenticate('github', function(err, user, info) {
			if (err) {
				return next(err)
			}
			if (user) {
				// `user` is either a user object or false
				return AuthenticationController.finishLogin(user, req, res, next)
			} else {
				if (info.redir != null) {
					return res.json({ redir: info.redir })
				} else {
					return res.sendStatus(401)
				}
			}
		})(req, res, next)
	},
);

webRouter.get(
	'/project/:project_id/threads',
	AuthorizationMiddleware.ensureUserCanReadProject,
	function (req, res, next) {
		const { project_id } = req.params;
		logger.log({ project_id }, 'CG:GET:project/threads');
		return ChatApiHandler.getThreads(project_id, function(err, threads) {
			if (err != null) return next(err);
			ChatController._injectUserInfoIntoThreads(threads, function (err) {
				if (err != null) return next(err);
				return res.json(threads);
			});
		});
	},
);

webRouter.get(
	'/project/:project_id/changes/users',
	AuthorizationMiddleware.ensureUserCanReadProject,
	function (req, res, next) {
		const { project_id } = req.params;
		logger.log({ project_id }, 'CG:GET:project/changes/users');
		return DocumentUpdaterHandler.flushProjectToMongo(project_id, function(err) {
			if (err != null) return next(err);
			return DocstoreManager.getAllRanges(project_id, function (err, docs) {
				if (err != null) return next(err);
				const user_ids = {};
				for (let doc of Array.from(docs)) {
					for (let change of Array.from((doc.ranges != null ? doc.ranges.changes : undefined) || [])) {
						user_ids[change.metadata.user_id] = true;
					}
				}
				return async.mapSeries(Object.keys(user_ids), UserInfoManager.getPersonalInfo, function(err, users) {
					if (err) return next(err);
					return res.json(users.filter(u => u != null).map(UserInfoController.formatPersonalInfo));
				});
			});
		});
	},
);

webRouter.post(
	'/project/:project_id/track_changes',
	AuthorizationMiddleware.ensureUserCanWriteProjectSettings,
	function (req, res, next) {
		const { project_id } = req.params;
		const { on, on_for, on_for_guests } = req.body;
		logger.log({ project_id, on, on_for, on_for_guests }, 'CG:POST:project/track_changes');
		var s;
		if (on === true) {
			s = true;
		} else {
			s = {};
			if (on_for_guests === true)
				s['__guests__'] = true;
			for (user_id in on_for)
				if (typeof(user_id) === 'string' && typeof(on_for[user_id]) === 'boolean')
					s[user_id] = on_for[user_id];
		}
		return Project.update(
			{ _id: project_id },
			{ track_changes: s },
			{},
			function (err) {
				if (err != null) return next(err);
				EditorRealTimeController.emitToRoom(project_id, "toggle-track-changes", s);
				return res.sendStatus(204);
			}
		);
	},
);

webRouter.post(
	'/project/:project_id/doc/:doc_id/changes/accept',
	AuthorizationMiddleware.ensureUserCanWriteProjectContent,
	function (req, res, next) {
		const { project_id, doc_id } = req.params;
		const { change_ids } = req.body;
		logger.log({ project_id, doc_id }, 'CG:POST:project/doc/changes/accept');
		return DocumentUpdaterHandler.acceptChanges(project_id, doc_id, change_ids, function (err) {
			if (err != null) return next(err);
			return res.sendStatus(204);
		});
	},
);

webRouter.get(
	'/project/:project_id/ranges',
	AuthorizationMiddleware.ensureUserCanReadProject,
	function (req, res, next) {
		const { project_id } = req.params;
		logger.log({ project_id }, 'CG:GET:project/ranges');
		return DocumentUpdaterHandler.flushProjectToMongo(project_id, function(err) {
			if (err) return next(err);
			return DocstoreManager.getAllRanges(project_id, function (err, data) {
				if (err != null) return next(err);
				return res.json(data);
			});
		});
	},
);

webRouter.post(
	'/project/:project_id/thread/:thread_id/messages',
	AuthorizationMiddleware.ensureUserCanReadProject,
	function (req, res, next) {
		const { project_id, thread_id } = req.params;
		const { content } = req.body;
		const user_id = AuthenticationController.getLoggedInUserId(req);
		logger.log({ project_id, thread_id }, 'CG:POST:project/thread/messages');
		return ChatApiHandler.sendComment(project_id, thread_id, user_id, content, function (err, message) {
			if (err != null) {
				return next(err)
			}
			return UserInfoManager.getPersonalInfo(message.user_id, function(
				err,
				user
			) {
				if (err != null) {
					return next(err)
				}
				message.user = UserInfoController.formatPersonalInfo(user)
				EditorRealTimeController.emitToRoom(
					project_id,
					'new-comment',
					thread_id,
					message
				)
				return res.sendStatus(204)
			})
		});
	},
);

webRouter.post(
	'/project/:project_id/thread/:thread_id/messages/:message_id/edit',
	AuthorizationMiddleware.ensureUserCanWriteProjectContent,
	function (req, res, next) {
		const { project_id, thread_id, message_id } = req.params;
		const { content } = req.body;
		logger.log({ project_id, thread_id, message_id }, 'CG:POST:project/thread/messages/edit');
		return ChatApiHandler.editMessage(project_id, thread_id, message_id, content, function (err) {
			if (err != null) return next(err);
			EditorRealTimeController.emitToRoom(project_id, 'edit-message', thread_id, message_id, content);
			res.sendStatus(204);
		});
	},
);

webRouter.delete(
	'/project/:project_id/thread/:thread_id/messages/:message_id',
	AuthorizationMiddleware.ensureUserCanWriteProjectContent,
	function (req, res, next) {
		const { project_id, thread_id, message_id } = req.params;
		logger.log({ project_id, thread_id, message_id }, 'CG:DELETE:project/thread/messages');
		return ChatApiHandler.deleteMessage(project_id, thread_id, message_id, function (err) {
			if (err != null) return next(err);
			EditorRealTimeController.emitToRoom(project_id, "delete-message", thread_id, message_id);
			res.sendStatus(204);
		});
	},
);

webRouter.post(
	'/project/:project_id/thread/:thread_id/resolve',
	AuthorizationMiddleware.ensureUserCanWriteProjectContent,
	function (req, res, next) {
		const { project_id, thread_id } = req.params;
		const user_id = AuthenticationController.getLoggedInUserId(req);
		logger.log({ project_id, thread_id }, 'CG:POST:project/thread/resolve');
		return ChatApiHandler.resolveThread(project_id, thread_id, user_id, function (err) {
			if (err != null) return next(err);
			UserInfoManager.getPersonalInfo(user_id, function(err, user) {
				if (err != null) return;
				EditorRealTimeController.emitToRoom(project_id, "resolve-thread", thread_id, user);
			});
			return res.sendStatus(204);
		});
	},
);

webRouter.post(
	'/project/:project_id/thread/:thread_id/reopen',
	AuthorizationMiddleware.ensureUserCanWriteProjectContent,
	function (req, res, next) {
		const { project_id, thread_id } = req.params;
		logger.log({ project_id, thread_id }, 'CG:POST:project/thread/reopen');
		return ChatApiHandler.reopenThread(project_id, thread_id, function (err) {
			if (err != null) return next(err);
			EditorRealTimeController.emitToRoom(project_id, "reopen-thread", thread_id);
			return res.sendStatus(204);
		});
	},
);

webRouter.delete(
	'/project/:project_id/doc/:doc_id/thread/:thread_id',
	AuthorizationMiddleware.ensureUserCanWriteProjectContent,
	function (req, res, next) {
		const { project_id, doc_id, thread_id } = req.params;
		logger.log({ project_id, doc_id, thread_id }, 'CG:DELETE:project/doc/thread');
		return ChatApiHandler.deleteThread(project_id, thread_id, function (err) {
			if (err != null) return next(err);
			EditorRealTimeController.emitToRoom(project_id, "delete-thread", thread_id);
			return DocumentUpdaterHandler.deleteThread(project_id, doc_id, thread_id, function (err) {
				if (err != null) return next(err);
				return res.sendStatus(204);
			});
		});
	},
);

}};
